import React, { useId, useMemo, useState } from 'react'

import {
  COVERAGE_MAX,
  COVERAGE_MIN,
  COVERAGE_STEP,
  MAX_YEARS,
  PLANS,
  estimate,
} from '../lib/premium'

import { inr, inrShort } from '../lib/format'

const ACTIVE_PLANS = PLANS.filter((plan) => plan.active === true)

const C = {
  green: '#047857',
  dark: '#064e3b',
  deep: '#12372a',
  light: '#ecfdf5',
  border: '#dce9e2',
  muted: '#64766d',
  white: '#ffffff',
  text: '#172b23',
}

const clamp = (value, min, max) => {
  const number = Number(value)

  if (!Number.isFinite(number)) return min

  return Math.min(Math.max(number, min), max)
}

const styles = {
  root: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    padding: 'clamp(14px, 2vw, 22px)',
    color: C.text,
    background: C.white,
    border: `1px solid ${C.border}`,
    borderRadius: 18,
    boxShadow: '0 12px 34px rgba(6,95,70,0.08)',
    fontFamily: 'inherit',
    overflowWrap: 'anywhere',
  },

  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 18,
  },

  heading: {
    flex: 1,
    minWidth: 0,
  },

  eyebrow: {
    display: 'inline-flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
    marginBottom: 8,
    color: C.green,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: 1.1,
  },

  dot: {
    width: 7,
    height: 7,
    flexShrink: 0,
    borderRadius: '50%',
    background: '#10b981',
    boxShadow: '0 0 0 3px #d1fae5',
  },

  title: {
    margin: 0,
    color: C.deep,
    fontSize: 'clamp(20px, 2.2vw, 26px)',
    fontWeight: 800,
    letterSpacing: '-0.5px',
    lineHeight: 1.25,
    overflowWrap: 'anywhere',
  },

  description: {
    maxWidth: 420,
    margin: '7px 0 0',
    color: C.muted,
    fontSize: 12,
    lineHeight: 1.6,
  },

  shield: {
    display: 'grid',
    width: 40,
    height: 40,
    flex: '0 0 40px',
    placeItems: 'center',
    color: C.green,
    background: C.light,
    border: '1px solid #d1fae5',
    borderRadius: 12,
  },

  section: {
    minWidth: 0,
    marginTop: 17,
  },

  label: {
    display: 'block',
    color: '#53675c',
    fontSize: 11,
    fontWeight: 700,
  },

  planOptions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 9,
  },

  planChip: {
    maxWidth: '100%',
    padding: '8px 10px',
    color: '#42574b',
    background: C.white,
    border: '1px solid #dce8e0',
    borderRadius: 9,
    fontFamily: 'inherit',
    fontSize: 11,
    fontWeight: 650,
    lineHeight: 1.35,
    cursor: 'pointer',
    transition: 'all 180ms ease',
  },

  planChipActive: {
    color: C.white,
    background: 'linear-gradient(135deg,#047857,#059669)',
    borderColor: 'transparent',
    boxShadow: '0 4px 11px rgba(4,120,87,0.16)',
  },

  premium: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
    padding: 'clamp(14px, 2vw, 19px)',
    color: C.white,
    background:
      'linear-gradient(120deg,#064e3b 0%,#047857 55%,#059669 100%)',
    borderRadius: 14,
  },

  premiumMain: {
    flex: '1 1 140px',
    minWidth: 0,
  },

  premiumLabel: {
    color: '#d1fae5',
    fontSize: 11,
    fontWeight: 700,
  },

  price: {
    marginTop: 6,
    fontSize: 'clamp(23px, 3vw, 32px)',
    fontWeight: 850,
    letterSpacing: '-0.7px',
    lineHeight: 1.25,
    overflowWrap: 'anywhere',
    fontVariantNumeric: 'tabular-nums',
  },

  caption: {
    display: 'block',
    marginTop: 5,
    color: '#d1fae5',
    fontSize: 11,
  },

  priceTag: {
    display: 'flex',
    minWidth: 0,
    maxWidth: '100%',
    flex: '0 1 auto',
    flexDirection: 'column',
    gap: 5,
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.12)',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 10,
  },

  priceTagLabel: {
    color: '#d1fae5',
    fontSize: 10,
    fontWeight: 600,
  },

  priceTagValue: {
    fontSize: 'clamp(13px, 1.6vw, 15px)',
    fontWeight: 800,
    overflowWrap: 'anywhere',
    fontVariantNumeric: 'tabular-nums',
  },

  controlHeading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },

  controlValue: {
    color: '#065f46',
    fontSize: 13,
    fontWeight: 800,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },

  range: {
    display: 'block',
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
    height: 6,
    margin: 0,
    accentColor: C.green,
    cursor: 'pointer',
  },

  rangeLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 8,
    color: '#78877e',
    fontSize: 10,
    fontWeight: 600,
  },

  breakdown: {
    minWidth: 0,
    marginTop: 17,
    padding: '13px 14px',
    background: '#f8fbf9',
    border: '1px solid #e4eee7',
    borderRadius: 12,
  },

  breakdownHeading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
    color: '#193b2c',
    fontSize: 12,
    fontWeight: 800,
  },

  estimateTag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '4px 7px',
    color: C.green,
    background: '#dcfce7',
    borderRadius: 7,
    fontSize: 9,
    fontWeight: 750,
  },

  breakdownRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    padding: '8px 0',
    color: '#627268',
    fontSize: 11,
    lineHeight: 1.45,
  },

  breakdownValue: {
    flex: '0 1 auto',
    minWidth: 0,
    color: '#263d31',
    textAlign: 'right',
    fontSize: 11,
    overflowWrap: 'anywhere',
    fontVariantNumeric: 'tabular-nums',
  },

  totalRow: {
    marginTop: 4,
    paddingTop: 12,
    color: '#124a35',
    borderTop: '1px solid #dce9e1',
    fontSize: 12,
    fontWeight: 800,
  },

  totalValue: {
    color: C.green,
    fontSize: 15,
    fontWeight: 850,
  },

  discount: {
    color: C.green,
  },

  disclaimer: {
    margin: '12px 0 0',
    color: '#77857c',
    fontSize: 10,
    lineHeight: 1.65,
  },
}

export default function CoverageDial({
  value = {},
  onChange,
  planKey,
  onPlanChange,
  showPlans = true,
  lockedPlan = false,
  planLabel,
  premiumEstimate,
  coverageMin = COVERAGE_MIN,
  coverageMax = COVERAGE_MAX,
  coverageStep = COVERAGE_STEP,
  durationMax = MAX_YEARS,
}) {
  const id = useId()

  const [hoveredPlan, setHoveredPlan] = useState(null)

  const coverageId = `${id}-coverage`
  const yearsId = `${id}-years`

  const selectedPlan =
    ACTIVE_PLANS.find((plan) => plan.key === planKey) ||
    ACTIVE_PLANS[0] ||
    PLANS[0]

  const minCoverage = Math.max(
    1,
    Number(coverageMin) || COVERAGE_MIN,
  )

  const maxCoverage = Math.max(
    minCoverage,
    Number(coverageMax) || COVERAGE_MAX,
  )

  const stepCoverage = Math.max(
    1,
    Number(coverageStep) || COVERAGE_STEP,
  )

  const maxDuration = Math.max(
    1,
    Math.min(
      MAX_YEARS,
      Math.floor(Number(durationMax) || MAX_YEARS),
    ),
  )

  const coverage = clamp(
    value.coverage ?? selectedPlan?.coverage ?? minCoverage,
    minCoverage,
    maxCoverage,
  )

  const years = clamp(
    value.years ?? 1,
    1,
    maxDuration,
  )

  const calculatedEstimate = useMemo(
    () => estimate(selectedPlan?.key, coverage, years),
    [selectedPlan?.key, coverage, years],
  )

  const est =
    lockedPlan && premiumEstimate
      ? premiumEstimate
      : calculatedEstimate

  const total = Number(est?.total) || 0
  const perYear = Number(est?.perYear) || 0
  const base = Number(est?.base) || 0
  const discount = Number(est?.discount) || 0
  const gst = Number(est?.gst) || 0
  const gstRate = Number(est?.gstRate) || 0

  const displayPlanName =
    planLabel ||
    selectedPlan?.label ||
    selectedPlan?.name ||
    'Insurance plan'

  const updateCoverage = (nextCoverage) => {
    onChange?.({
      ...value,
      coverage: clamp(
        nextCoverage,
        minCoverage,
        maxCoverage,
      ),
      years,
    })
  }

  const updateYears = (nextYears) => {
    onChange?.({
      ...value,
      coverage,
      years: clamp(
        nextYears,
        1,
        maxDuration,
      ),
    })
  }

  const choosePlan = (nextPlanKey) => {
    if (
      lockedPlan ||
      nextPlanKey === selectedPlan?.key
    ) {
      return
    }

    const nextPlan = ACTIVE_PLANS.find(
      (plan) => plan.key === nextPlanKey,
    )

    if (!nextPlan) return

    onChange?.({
      ...value,
      coverage: clamp(
        nextPlan.coverage,
        minCoverage,
        maxCoverage,
      ),
      years,
    })

    onPlanChange?.(nextPlan.key)
  }

  const renderBreakdownRow = (
    label,
    amount,
    extraStyle = {},
    valueStyle = {},
  ) => (
    <div style={{ ...styles.breakdownRow, ...extraStyle }}>
      <span
        style={{
          minWidth: 0,
          overflowWrap: 'anywhere',
        }}
      >
        {label}
      </span>

      <strong
        style={{
          ...styles.breakdownValue,
          ...valueStyle,
        }}
      >
        {amount}
      </strong>
    </div>
  )

  return (
    <section
      className="ix-coverage-dial"
      aria-label="Coverage and premium calculator"
      style={styles.root}
    >
      <header style={styles.header}>
        <div style={styles.heading}>
          <span style={styles.eyebrow}>
            <span style={styles.dot} />
            INSUREX PREMIUM ESTIMATOR
          </span>

          <h3 style={styles.title}>
            {displayPlanName}
          </h3>

          <p style={styles.description}>
            Personalize your coverage and policy term to estimate
            your insurance premium.
          </p>
        </div>

        <div
          style={styles.shield}
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        </div>
      </header>

      {showPlans && !lockedPlan && (
        <div
          style={{
            ...styles.section,
            marginTop: 0,
            marginBottom: 17,
          }}
        >
          <span style={styles.label}>
            Choose your plan
          </span>

          <div
            role="group"
            aria-label="Available insurance plans"
            style={styles.planOptions}
          >
            {ACTIVE_PLANS.map((plan) => {
              const active = plan.key === selectedPlan?.key
              const hovered = hoveredPlan === plan.key

              return (
                <button
                  key={plan.key}
                  type="button"
                  onClick={() => choosePlan(plan.key)}
                  onMouseEnter={() => setHoveredPlan(plan.key)}
                  onMouseLeave={() => setHoveredPlan(null)}
                  onFocus={() => setHoveredPlan(plan.key)}
                  onBlur={() => setHoveredPlan(null)}
                  aria-pressed={active}
                  style={{
                    ...styles.planChip,
                    ...(active ? styles.planChipActive : {}),
                    ...(!active && hovered
                      ? {
                          borderColor: '#6ee7b7',
                          color: C.dark,
                          transform: 'translateY(-1px)',
                          boxShadow:
                            '0 4px 10px rgba(4,120,87,0.08)',
                        }
                      : {}),
                  }}
                >
                  {plan.label || plan.name || plan.key}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div style={styles.premium}>
        <div style={styles.premiumMain}>
          <span style={styles.premiumLabel}>
            Estimated total premium
          </span>

          <div
            style={styles.price}
            aria-live="polite"
          >
            {inr(total)}
          </div>

          <span style={styles.caption}>
            For {years} {years === 1 ? 'year' : 'years'}
          </span>
        </div>

        <div style={styles.priceTag}>
          <span style={styles.priceTagLabel}>
            Average per year
          </span>

          <strong
            style={styles.priceTagValue}
            aria-live="polite"
          >
            {inr(perYear)}
          </strong>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.controlHeading}>
          <label
            htmlFor={coverageId}
            style={styles.label}
          >
            Coverage amount
          </label>

          <output
            htmlFor={coverageId}
            style={styles.controlValue}
          >
            {inrShort(coverage)}
          </output>
        </div>

        <input
          id={coverageId}
          type="range"
          min={minCoverage}
          max={maxCoverage}
          step={stepCoverage}
          value={coverage}
          onChange={(event) =>
            updateCoverage(event.target.value)
          }
          aria-label="Coverage amount"
          aria-valuetext={inr(coverage)}
          style={styles.range}
        />

        <div style={styles.rangeLabels}>
          <span>{inrShort(minCoverage)}</span>
          <span>{inrShort(maxCoverage)}</span>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.controlHeading}>
          <label
            htmlFor={yearsId}
            style={styles.label}
          >
            Policy duration
          </label>

          <output
            htmlFor={yearsId}
            style={styles.controlValue}
          >
            {years} {years === 1 ? 'year' : 'years'}
          </output>
        </div>

        <input
          id={yearsId}
          type="range"
          min={1}
          max={maxDuration}
          step={1}
          value={years}
          onChange={(event) =>
            updateYears(event.target.value)
          }
          aria-label="Policy duration in years"
          aria-valuetext={`${years} ${
            years === 1 ? 'year' : 'years'
          }`}
          style={styles.range}
        />

        <div style={styles.rangeLabels}>
          <span>1 year</span>
          <span>
            {maxDuration}{' '}
            {maxDuration === 1 ? 'year' : 'years'}
          </span>
        </div>
      </div>

      <div style={styles.breakdown}>
        <div style={styles.breakdownHeading}>
          <span>Premium breakdown</span>

          <span style={styles.estimateTag}>
            <span aria-hidden="true">✓</span>
            Estimate
          </span>
        </div>

        {renderBreakdownRow(
          'Base premium',
          inr(base),
        )}

        {renderBreakdownRow(
          `Multi-year discount ${discount > 0 ? '(5%)' : ''}`,
          discount > 0 ? `−${inr(discount)}` : inr(0),
          {},
          discount > 0 ? styles.discount : {},
        )}

        {renderBreakdownRow(
          `GST (${gstRate}%)`,
          inr(gst),
        )}

        {renderBreakdownRow(
          'Estimated payable',
          inr(total),
          styles.totalRow,
          styles.totalValue,
        )}
      </div>

      <p style={styles.disclaimer}>
        This is an indicative estimate based on the selected
        plan, coverage and policy term. InsureX's backend
        determines the final payable amount and applicable taxes
        during purchase.
      </p>
    </section>
  )
}
