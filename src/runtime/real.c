#include "real.h"
#include "panic.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

// ---------------------------------------------------------------------------
// RC hooks
// ---------------------------------------------------------------------------

static void retainNestedFields(void* self) {
    retainRC(((Real*) self)->significand);
}

static void releaseNestedFields(void* self) {
    Real* real = (Real*) self;
    releaseRC(real->significand);
    if (real->string_cache) releaseRC(real->string_cache);
}

const __type_info Realˇtype = {
    .data_type = {
        .size = sizeof(Real),
        .retain_nested_fields = retainNestedFields,
        .release_nested_fields = releaseNestedFields,
    },
};

// ---------------------------------------------------------------------------
// Small-integer helpers (no public Integer API for construction from digit_t)
// ---------------------------------------------------------------------------

// Create an Integer whose value equals one balanced digit.
static Integer* integerFromDigit(digit_t v) {
    if (v == 0) return retainRC(&Integer¸zero);
    Integer* i = allocRC(Integer, __rc_ISOLATED);
    i->digits = Array¸new(1, sizeof(digit_t));
    ARRAY_ELEMENT_AT(0, i->digits, digit_t) = v;
    return i;
}

// Create an Integer representing 10^n (n >= 0).
static Integer* integerPowerOf10(uint32_t n) {
    Integer* result = integerFromDigit(1);
    Integer* ten    = integerFromDigit(10);
    for (uint32_t i = 0; i < n; i++) {
        Integer* next = Integer¸multiply(result, ten);
        releaseRC(result);
        result = next;
    }
    releaseRC(ten);
    return result;
}

// ---------------------------------------------------------------------------
// Significand parsing: convert decimal digit string to Integer.
// Processes in groups of 18 to stay comfortably within a single balanced digit.
// ---------------------------------------------------------------------------

static Integer* parseSignificand(const char* digits, size_t len) {
    Integer* result = retainRC(&Integer¸zero);
    Integer* base   = integerFromDigit(1000000000000000000LL); // 10^18

    size_t i = 0;
    while (i < len) {
        size_t chunk = (len - i < 18) ? (len - i) : 18;
        digit_t limb = 0;
        for (size_t k = 0; k < chunk; k++)
            limb = limb * 10 + (digits[i + k] - '0');

        // result = result * 10^chunk + limb
        Integer* scale  = integerFromDigit((digit_t[]){1,10,100,1000,10000,100000,
                                            1000000,10000000,100000000,
                                            1000000000,10000000000LL,100000000000LL,
                                            1000000000000LL,10000000000000LL,
                                            100000000000000LL,1000000000000000LL,
                                            10000000000000000LL,100000000000000000LL}[chunk]);
        Integer* shifted = Integer¸multiply(result, scale);
        releaseRC(scale);
        releaseRC(result);

        Integer* limbInt = integerFromDigit(limb);
        result = Integer¸add(shifted, limbInt);
        releaseRC(shifted);
        releaseRC(limbInt);

        i += chunk;
    }

    releaseRC(base);
    return result;
}

// ---------------------------------------------------------------------------
// Normalization: remove trailing zeros from significand, adjust exponent.
// ---------------------------------------------------------------------------

static void normalize(Integer** sig, int32_t* exp) {
    Integer* ten      = integerFromDigit(10);
    Integer* zero_int = retainRC(&Integer¸zero);

    while (true) {
        // Check if significand is zero — stop immediately.
        bool is_zero = true;
        for (size_t i = 0; i < (*sig)->digits->count; i++) {
            if (ARRAY_ELEMENT_AT(i, (*sig)->digits, digit_t) != 0) { is_zero = false; break; }
        }
        if (is_zero) break;

        // Check last decimal digit using single-digit division.
        Integer* tmp = retainRC(*sig);
        mutateRC(tmp);
        digit_t rem = Integer·divide(tmp, 10);
        releaseRC(tmp);
        if (rem != 0) break;

        // Strip a trailing zero.
        Integer* next = Integer¸divide(*sig, ten);
        releaseRC(*sig);
        *sig = next;
        (*exp)++;
    }

    releaseRC(ten);
    releaseRC(zero_int);
}

// ---------------------------------------------------------------------------
// String cache helpers
// ---------------------------------------------------------------------------

static char* cloneString(const char* s) {
    size_t len = strlen(s);
    char* out = malloc(len + 1);
    if (!out) panic("Out of memory in Real string clone");
    memcpy(out, s, len + 1);
    return out;
}

// Build decimal string from significand + exponent10.
// Returns an owned String object.
static String* formatReal(Integer* sig, int32_t exp) {
    // Get the absolute decimal digit string from Integer·toString.
    // Integer·toString includes a leading '-' for negatives.
    String* rawString = Integer·toStringRC(sig);
    const char* raw = String·toCString(rawString);
    bool negative = (raw[0] == '-');
    const char* digits = negative ? raw + 1 : raw;
    size_t ndigits = strlen(digits);

    // Handle zero specially.
    if (ndigits == 0 || (ndigits == 1 && digits[0] == '0')) {
        releaseRC(rawString);
        return String¸fromCString("0.0");
    }

    // The value is:  digits * 10^exp
    // We want to render it in decimal notation where possible.
    // dot_pos = position of decimal point from the left of `digits`.
    //   dot_pos = ndigits + exp  (i.e. number of digits before the point)
    //
    // Examples:
    //   digits="123", exp=-2  → dot_pos=1  → "1.23"
    //   digits="1",   exp=0   → dot_pos=1  → "1.0"
    //   digits="1",   exp=2   → dot_pos=3  → "100.0"
    //   digits="333", exp=-5  → dot_pos=-2 → "0.00333"

    int64_t dot_pos = (int64_t) ndigits + exp;  // digits before decimal point

    // Determine output buffer size (generous upper bound).
    size_t extra = 16;  // sign, '.', leading/trailing zeros, ".0", NUL
    size_t bufsize = (negative ? 1 : 0) + ndigits + extra + (dot_pos < 0 ? (size_t)(-dot_pos) : 0) + (dot_pos > (int64_t)ndigits ? (size_t)(dot_pos - ndigits) : 0);
    char* out = malloc(bufsize);
    if (!out) panic("Out of memory in Real formatter");

    char* p = out;
    if (negative) *p++ = '-';

    if (dot_pos <= 0) {
        // All digits are fractional, possibly with leading zeros after the point.
        *p++ = '0'; *p++ = '.';
        for (int64_t z = 0; z < -dot_pos; z++) *p++ = '0';
        memcpy(p, digits, ndigits); p += ndigits;
    } else if (dot_pos >= (int64_t) ndigits) {
        // All digits are before the decimal point, with possible trailing zeros.
        memcpy(p, digits, ndigits); p += ndigits;
        for (int64_t z = ndigits; z < dot_pos; z++) *p++ = '0';
        *p++ = '.'; *p++ = '0';  // type-revealing marker
    } else {
        // Decimal point falls within the digits.
        memcpy(p, digits, (size_t) dot_pos); p += dot_pos;
        *p++ = '.';
        memcpy(p, digits + dot_pos, ndigits - (size_t) dot_pos); p += ndigits - (size_t) dot_pos;
    }
    *p = '\0';

    String* result = String¸fromCString(out);
    free(out);
    releaseRC(rawString);
    return result;
}

// ---------------------------------------------------------------------------
// fromString
// ---------------------------------------------------------------------------

Real* Real¸fromString(const char* value) {
    // Strip readability underscores.
    size_t vlen = strlen(value);
    char* stripped = malloc(vlen + 1);
    if (!stripped) panic("Out of memory in Real¸fromString");
    size_t j = 0;
    for (size_t i = 0; i < vlen; i++)
        if (value[i] != '_') stripped[j++] = value[i];
    stripped[j] = '\0';

    bool negative = (stripped[0] == '-');
    const char* s = negative ? stripped + 1 : stripped;

    // Split off scientific exponent if present.
    const char* eptr = strpbrk(s, "eE");
    int32_t sci_exp = 0;
    if (eptr) {
        char* end;
        long parsed_sci = strtol(eptr + 1, &end, 10);
        if (*end != '\0') { free(stripped); panic("Invalid real literal (bad exponent)"); }
        sci_exp = (int32_t) parsed_sci;
    }

    // Find decimal point in the coefficient portion.
    size_t coeff_len = eptr ? (size_t)(eptr - s) : strlen(s);
    const char* dot = memchr(s, '.', coeff_len);
    int32_t exp = 0;
    char* digits_buf;

    if (dot) {
        size_t int_len  = (size_t)(dot - s);
        size_t frac_len = coeff_len - int_len - 1;
        digits_buf = malloc(int_len + frac_len + 1);
        if (!digits_buf) panic("Out of memory in Real¸fromString");
        memcpy(digits_buf, s, int_len);
        memcpy(digits_buf + int_len, dot + 1, frac_len);
        digits_buf[int_len + frac_len] = '\0';
        exp = -(int32_t) frac_len;
    } else {
        digits_buf = malloc(coeff_len + 1);
        if (!digits_buf) panic("Out of memory in Real¸fromString");
        memcpy(digits_buf, s, coeff_len);
        digits_buf[coeff_len] = '\0';
        exp = 0;
    }
    exp += sci_exp;

    // Validate all characters are decimal digits.
    for (size_t i = 0; digits_buf[i]; i++) {
        if (digits_buf[i] < '0' || digits_buf[i] > '9') {
            free(digits_buf); free(stripped);
            panic("Invalid real literal");
        }
    }

    // Skip leading zeros in digit string (but keep at least one).
    const char* d = digits_buf;
    while (*d == '0' && *(d + 1)) d++;

    Integer* sig = parseSignificand(d, strlen(d));
    normalize(&sig, &exp);

    if (negative) Integer·toggleSign(sig);

    Real* real = allocRC(Real, __rc_ISOLATED);
    real->significand       = sig;
    real->exponent10        = exp;
    real->context_precision = CLAWR_REAL_DEFAULT_PRECISION;
    real->string_cache      = String¸fromCString(stripped);  // pre-populate from source
    real->cache_valid       = true;

    free(digits_buf);
    free(stripped);
    return real;
}

// ---------------------------------------------------------------------------
// toString
// ---------------------------------------------------------------------------

String* Real·toStringRC(Real* self) {
    if (!self->cache_valid) {
        if (self->string_cache) releaseRC(self->string_cache);
        self->string_cache = formatReal(self->significand, self->exponent10);
        self->cache_valid  = true;
    }
    return retainRC(self->string_cache);
}

const char* Real·toString(Real* self) {
    String* s = Real·toStringRC(self);
    const char* out = cloneString(String·toCString(s));
    releaseRC(s);
    return out;
}

// ---------------------------------------------------------------------------
// Arithmetic helpers
// ---------------------------------------------------------------------------

// Align two reals to a common exponent; returns new significands (owned).
// After alignment: left_out * 10^common_exp == left->value, same for right.
static void alignExponents(Real* left, Real* right,
                           Integer** left_out, Integer** right_out,
                           int32_t* common_exp) {
    if (left->exponent10 == right->exponent10) {
        *left_out   = retainRC(left->significand);
        *right_out  = retainRC(right->significand);
        *common_exp = left->exponent10;
        return;
    }
    if (left->exponent10 > right->exponent10) {
        // Scale left up: left_sig * 10^(left.exp - right.exp)
        int32_t diff = left->exponent10 - right->exponent10;
        Integer* scale = integerPowerOf10((uint32_t) diff);
        *left_out   = Integer¸multiply(left->significand, scale);
        releaseRC(scale);
        *right_out  = retainRC(right->significand);
        *common_exp = right->exponent10;
    } else {
        int32_t diff = right->exponent10 - left->exponent10;
        Integer* scale = integerPowerOf10((uint32_t) diff);
        *left_out   = retainRC(left->significand);
        *right_out  = Integer¸multiply(right->significand, scale);
        releaseRC(scale);
        *common_exp = left->exponent10;
    }
}

static Real* realWithSigExp(Integer* sig, int32_t exp, uint32_t precision) {
    normalize(&sig, &exp);
    Real* r = allocRC(Real, __rc_ISOLATED);
    r->significand       = sig;
    r->exponent10        = exp;
    r->context_precision = precision;
    r->string_cache      = NULL;
    r->cache_valid       = false;
    return r;
}

// ---------------------------------------------------------------------------
// Public arithmetic
// ---------------------------------------------------------------------------

Real* Real¸add(Real* left, Real* right) {
    Integer* ls; Integer* rs; int32_t exp;
    alignExponents(left, right, &ls, &rs, &exp);
    Integer* sum = Integer¸add(ls, rs);
    releaseRC(ls); releaseRC(rs);
    return realWithSigExp(sum, exp, left->context_precision);
}

Real* Real¸subtract(Real* left, Real* right) {
    Integer* ls; Integer* rs; int32_t exp;
    alignExponents(left, right, &ls, &rs, &exp);
    Integer* diff = Integer¸subtract(ls, rs);
    releaseRC(ls); releaseRC(rs);
    return realWithSigExp(diff, exp, left->context_precision);
}

Real* Real¸multiply(Real* left, Real* right) {
    Integer* prod = Integer¸multiply(left->significand, right->significand);
    int32_t  exp  = left->exponent10 + right->exponent10;
    return realWithSigExp(prod, exp, left->context_precision);
}

Real* Real¸divide(Real* dividend, Real* divisor) {
    // Check for zero divisor.
    bool divisor_zero = true;
    for (size_t i = 0; i < divisor->significand->digits->count; i++) {
        if (ARRAY_ELEMENT_AT(i, divisor->significand->digits, digit_t) != 0) {
            divisor_zero = false; break;
        }
    }
    if (divisor_zero) panic("Division by zero!");

    uint32_t prec = dividend->context_precision;

    // Scale dividend significand by 10^prec to preserve precision through division.
    Integer* scale   = integerPowerOf10(prec);
    Integer* scaled  = Integer¸multiply(dividend->significand, scale);
    releaseRC(scale);

    Integer* quotient = Integer¸divide(scaled, divisor->significand);
    releaseRC(scaled);

    // exponent: dividend.exp - divisor.exp - prec
    int32_t exp = dividend->exponent10 - divisor->exponent10 - (int32_t) prec;

    return realWithSigExp(quotient, exp, prec);
}

Real* Real¸power(Real* base, Real* exponent) {
    // Exponent must be a whole number: no negative exponent10 (fractional digits).
    if (exponent->exponent10 < 0)
        panic("Real exponentiation requires an integer exponent");

    // Build the full integer value: int_exp = significand * 10^exponent10
    Integer* int_exp;
    if (exponent->exponent10 == 0) {
        int_exp = retainRC(exponent->significand);
    } else {
        Integer* scale = integerPowerOf10((uint32_t) exponent->exponent10);
        int_exp = Integer¸multiply(exponent->significand, scale);
        releaseRC(scale);
    }

    // Reject negative exponents.
    bool is_negative = false;
    for (size_t i = 0; i < int_exp->digits->count; i++) {
        if (ARRAY_ELEMENT_AT(i, int_exp->digits, digit_t) < 0) { is_negative = true; break; }
    }
    if (is_negative) {
        releaseRC(int_exp);
        panic("Real exponentiation requires a non-negative exponent");
    }

    // Convert exponent to unsigned long long via toString (safe for practical sizes).
    String* exp_str_obj = Integer·toStringRC(int_exp);
    const char* exp_str = String·toCString(exp_str_obj);
    releaseRC(int_exp);
    char* end;
    unsigned long long e = strtoull(exp_str, &end, 10);
    releaseRC(exp_str_obj);
    if (*end != '\0') panic("Real exponent too large");

    // Binary exponentiation.
    Integer* one = integerFromDigit(1);
    Real* result = realWithSigExp(one, 0, base->context_precision);
    Real* b = retainRC(base);

    for (unsigned long long exp_rem = e; exp_rem > 0; exp_rem >>= 1) {
        if (exp_rem & 1) {
            Real* nr = Real¸multiply(result, b);
            releaseRC(result);
            result = nr;
        }
        if (exp_rem >> 1 > 0) {
            Real* nb = Real¸multiply(b, b);
            releaseRC(b);
            b = nb;
        }
    }

    releaseRC(b);
    return result;
}
