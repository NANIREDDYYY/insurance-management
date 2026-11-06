/**
 * InsureX Premium Calculator
 *
 * Baseline values match the supplied database plan records.
 * Adjustable coverage premiums are proportional estimates.
 *
 * Multi-year discount:
 * - No discount for 1-year policies.
 * - 5% discount applies for durations from 2–5 years.
 * - This is an InsureX pricing rule, not a government discount.
 *
 * GST assumptions:
 * - Health: 0% for qualifying individual/family policies.
 * - Life: 0% for qualifying individual/family policies.
 * - Motor: 18% estimate.
 * - Accident: 18% estimate (archived frontend plan only).
 *
 * Frontend estimates are not authoritative tax calculations.
 * The backend remains authoritative for payment amounts.
 */

export const PLANS = [
  {
    id: 1,
    key: 'HLT-BASIC',
    code: 'HLT-BASIC',
    label: 'Basic Health',
    name: 'Basic Health',
    type: 'Health',
    coverage: 300000,
    yearly: 2999,
    active: true,
    description:
      'Entry-level health coverage for eligible medical and hospitalization expenses.',
    duration: 1,
  },
  {
    id: 2,
    key: 'HLT-FAMILY',
    code: 'HLT-FAMILY',
    label: 'Family Health',
    name: 'Family Health',
    type: 'Health',
    coverage: 500000,
    yearly: 5999,
    active: true,
    description:
      'Family health coverage for eligible hospitalization and medical expenses.',
    duration: 1,
  },
  {
    id: 3,
    key: 'HLT-PREMIUM',
    code: 'HLT-PREMIUM',
    label: 'Premium Health',
    name: 'Premium Health',
    type: 'Health',
    coverage: 1000000,
    yearly: 9999,
    active: true,
    description:
      'Higher-limit health coverage for eligible medical and hospitalization expenses.',
    duration: 1,
  },
  {
    id: 4,
    key: 'LIF-ESSENTIAL',
    code: 'LIF-ESSENTIAL',
    label: 'Essential Life',
    name: 'Essential Life',
    type: 'Life',
    coverage: 1000000,
    yearly: 3999,
    active: true,
    description:
      'Basic life protection with a benefit payable on a covered death.',
    duration: 1,
  },
  {
    id: 5,
    key: 'LIF-FAMILY',
    code: 'LIF-FAMILY',
    label: 'Family Protection',
    name: 'Family Protection',
    type: 'Life',
    coverage: 2500000,
    yearly: 7999,
    active: true,
    description:
      'Life protection designed to provide financial support to beneficiaries.',
    duration: 1,
  },
  {
    id: 6,
    key: 'LIF-PREMIUM',
    code: 'LIF-PREMIUM',
    label: 'Premium Life',
    name: 'Premium Life',
    type: 'Life',
    coverage: 5000000,
    yearly: 12999,
    active: true,
    description:
      'Higher-value life protection for beneficiaries, subject to policy terms.',
    duration: 1,
  },
  {
    id: 7,
    key: 'MTR-BIKE',
    code: 'MTR-BIKE',
    label: 'Two-Wheeler Protect',
    name: 'Two-Wheeler Protect',
    type: 'Motor',
    coverage: 100000,
    yearly: 1499,
    active: true,
    description:
      'Sample two-wheeler coverage for eligible vehicle damage, subject to policy terms.',
    duration: 1,
  },
  {
    id: 8,
    key: 'MTR-CAR',
    code: 'MTR-CAR',
    label: 'Car Protect',
    name: 'Car Protect',
    type: 'Motor',
    coverage: 500000,
    yearly: 4999,
    active: true,
    description:
      'Sample car insurance coverage for eligible vehicle damage, subject to policy terms.',
    duration: 1,
  },
  {
    id: 9,
    key: 'MTR-COMP',
    code: 'MTR-COMP',
    label: 'Comprehensive Motor',
    name: 'Comprehensive Motor',
    type: 'Motor',
    coverage: 1000000,
    yearly: 8999,
    active: true,
    description:
      'Sample enhanced motor coverage for eligible damage and specified risks.',
    duration: 1,
  },
  {
    id: 21,
    key: 'ACCIDENT',
    code: 'ACCIDENT',
    label: 'Accident Insurance',
    name: 'Accident Insurance',
    type: 'Accident Insurance',
    coverage: 1000000,
    yearly: 1499,
    active: false,
    description:
      'Archived accident insurance plan retained for historical purchases.',
    duration: 1,
  },
]

export const ACTIVE_PLANS = PLANS.filter(
  (plan) => plan.active === true,
)

export const COVERAGE_MIN = 100000
export const COVERAGE_MAX = 10000000
export const COVERAGE_STEP = 100000

export const MAX_YEARS = 5

// InsureX discount for policies of 2–5 years.
export const MULTI_YEAR_DISCOUNT_RATE = 5

// Estimated category-based GST rates.
export const GST_RATES = {
  health: 0,
  life: 0,
  motor: 18,
  accident: 18,
}

// Fallback for unclassified frontend categories.
export const GST_RATE = 18

const round2 = (value) =>
  Math.round(
    (Number(value) + Number.EPSILON) * 100,
  ) / 100

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')

const CATEGORY_ALIASES = {
  health: ['health', 'medical'],
  life: ['life'],
  motor: ['motor', 'vehicle', 'auto'],
  accident: ['accident', 'personal accident'],
}

function matchesAlias(type, alias) {
  const normalizedType = normalize(type)
  const normalizedAlias = normalize(alias)

  return (
    normalizedType === normalizedAlias ||
    normalizedType === `${normalizedAlias} insurance` ||
    normalizedType.startsWith(`${normalizedAlias} `)
  )
}

/**
 * Returns the estimated GST rate for a plan or category.
 *
 * For actual InsureX plans, classification follows the same
 * plan-code prefixes used by the backend:
 * HLT- = 0%, LIF- = 0%, MTR- = 18%.
 *
 * Category-based handling is retained for frontend compatibility.
 */
export function gstRateForPlan(planOrType) {
  if (
    typeof planOrType === 'object' &&
    planOrType !== null
  ) {
    const code = String(
      planOrType.code ?? planOrType.key ?? '',
    )
      .trim()
      .toUpperCase()

    if (code.startsWith('HLT-')) {
      return GST_RATES.health
    }

    if (code.startsWith('LIF-')) {
      return GST_RATES.life
    }

    if (code.startsWith('MTR-')) {
      return GST_RATES.motor
    }
  }

  const type =
    typeof planOrType === 'object' && planOrType !== null
      ? planOrType.type
      : planOrType

  const normalizedType = normalize(type)

  if (
    CATEGORY_ALIASES.health.some((alias) =>
      matchesAlias(normalizedType, alias),
    )
  ) {
    return GST_RATES.health
  }

  if (
    CATEGORY_ALIASES.life.some((alias) =>
      matchesAlias(normalizedType, alias),
    )
  ) {
    return GST_RATES.life
  }

  if (
    CATEGORY_ALIASES.motor.some((alias) =>
      matchesAlias(normalizedType, alias),
    )
  ) {
    return GST_RATES.motor
  }

  if (
    CATEGORY_ALIASES.accident.some((alias) =>
      matchesAlias(normalizedType, alias),
    )
  ) {
    return GST_RATES.accident
  }

  return GST_RATE
}

/**
 * Finds an active plan by code, key, name, label, or category.
 * A category with multiple plans defaults to its first active plan.
 */
export function planFor(identifier) {
  if (identifier == null || identifier === '') {
    return ACTIVE_PLANS[0] ?? null
  }

  const value = normalize(identifier)

  const exactMatch = ACTIVE_PLANS.find(
    (plan) =>
      normalize(plan.key) === value ||
      normalize(plan.code) === value ||
      normalize(plan.label) === value ||
      normalize(plan.name) === value,
  )

  if (exactMatch) {
    return exactMatch
  }

  for (const [, categoryAliases] of Object.entries(
    CATEGORY_ALIASES,
  )) {
    if (
      categoryAliases.some(
        (alias) =>
          value === normalize(alias) ||
          value === `${normalize(alias)} insurance`,
      )
    ) {
      const matchingPlans = ACTIVE_PLANS.filter((plan) =>
        categoryAliases.some((alias) =>
          matchesAlias(plan.type, alias),
        ),
      )

      if (matchingPlans.length > 0) {
        return matchingPlans[0]
      }
    }
  }

  return null
}

export function activePlans() {
  return [...ACTIVE_PLANS]
}

export function plansForType(type) {
  const value = normalize(type)

  const aliases =
    Object.entries(CATEGORY_ALIASES).find(
      ([category, categoryAliases]) =>
        normalize(category) === value ||
        categoryAliases.some(
          (alias) =>
            normalize(alias) === value ||
            `${normalize(alias)} insurance` === value,
        ),
    )?.[1] ?? [value]

  return ACTIVE_PLANS.filter((plan) =>
    aliases.some((alias) =>
      matchesAlias(plan.type, alias),
    ),
  )
}

/**
 * Calculates an estimated premium using the plan's listed coverage
 * and yearly premium as the baseline.
 *
 * annualPremium = listed yearly premium × selected coverage / listed coverage
 * base = annualPremium × years
 * discount = 5% of base only when years >= 2
 * taxable = base - discount
 * GST = taxable × category GST rate
 * total = taxable + GST
 */
export function estimate(
  planIdentifier,
  coverage,
  years = 1,
) {
  const plan = planFor(planIdentifier)
  const selectedCoverage = Number(coverage)
  const selectedYears = Number(years)

  if (!plan) {
    return null
  }

  if (
    !Number.isFinite(selectedCoverage) ||
    selectedCoverage <= 0
  ) {
    return null
  }

  if (
    !Number.isInteger(selectedYears) ||
    selectedYears < 1 ||
    selectedYears > MAX_YEARS
  ) {
    return null
  }

  // Keep precision until the full policy-term base is calculated.
  const unroundedAnnualPremium =
    (plan.yearly * selectedCoverage) / plan.coverage

  const annualPremium = round2(unroundedAnnualPremium)

  const base = round2(
    unroundedAnnualPremium * selectedYears,
  )

  // Backend rule: apply 5% discount only for 2–5 years.
  const discountRate =
    selectedYears >= 2
      ? MULTI_YEAR_DISCOUNT_RATE
      : 0

  const discount = round2(
    (base * discountRate) / 100,
  )

  const taxable = round2(base - discount)
  const gstRate = gstRateForPlan(plan)

  const gst = round2(
    (taxable * gstRate) / 100,
  )

  const total = round2(taxable + gst)
  const perYear = round2(total / selectedYears)

  return {
    planId: plan.id,
    planCode: plan.code,
    planName: plan.name,
    planType: plan.type,

    coverage: selectedCoverage,
    years: selectedYears,

    listedCoverage: plan.coverage,
    listedAnnualPremium: plan.yearly,

    annualPremium,
    base,

    discount,
    discountRate,

    taxable,

    gstRate,
    gst,

    total,
    perYear,

    isEstimate: true,
  }
}
