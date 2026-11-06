
// =========================================================
// INSUREX — BUY POLICY / RENEW POLICY
// File: BuyPolicy.jsx
//
// New purchase • Renewal • Razorpay checkout
// Server-side verification • Duplicate-click protection
// Uncertain-payment protection • Query-cache synchronization
//
// The backend remains authoritative for payable amounts,
// payment verification, purchase completion and renewals.
// =========================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Link,
  useNavigate,
  useParams,
  useLocation,
} from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import {
  payment,
  plans,
  purchases,
  renewals,
  policies,
} from '../../api/endpoints'

import { errorMessage } from '../../api/client'

import {
  Button,
  DataState,
  Icon,
  PageHeader,
  Panel,
  SelectInput,
  TextInput,
} from '../../components/ui'

import { planFor } from '../../lib/premium'
import CoverageDial from '../../components/CoverageDial'

import { dateTime, inr, inrShort } from '../../lib/format'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'

/* =========================================================
   CONSTANTS
========================================================= */

const RELATIONS = [
  'Spouse',
  'Son',
  'Daughter',
  'Father',
  'Mother',
  'Brother',
  'Sister',
  'Other',
]

const STEPS = ['Cover', 'Nominee', 'Review and pay']

const RAZORPAY_SCRIPT =
  'https://checkout.razorpay.com/v1/checkout.js'

const LONG_TERM_DISCOUNT_RATE = 5
const MOTOR_GST_RATE = 18

/* =========================================================
   NORMALIZATION
========================================================= */

function normalizeRows(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.content)) return data.content
  if (Array.isArray(data?.data)) return data.data
  if (Array.isArray(data?.data?.content)) {
    return data.data.content
  }
  return []
}

function normalizePlans(data) {
  if (Array.isArray(data?.plans)) return data.plans
  return normalizeRows(data)
}

function isActivePlan(plan) {
  const value = plan?.isActive

  if (value === false || value === 0) return false

  return ![
    'false',
    '0',
    'no',
    'inactive',
    'disabled',
  ].includes(String(value ?? '').trim().toLowerCase())
}

function normalizedStatus(value) {
  return String(value ?? '').trim().toUpperCase()
}

function extractPolicyNumber(purchase) {
  return (
    purchase?.policyNumber ??
    purchase?.policy?.policyNumber ??
    null
  )
}

function getRenewalSource(purchase) {
  return (
    purchase?.renewedFromPolicyNumber ??
    purchase?.renewalSourcePolicyNumber ??
    purchase?.renewedFromPurchase?.policyNumber ??
    purchase?.renewedFromPurchase?.policy?.policyNumber ??
    null
  )
}

function isCompletedRenewal(purchase, sourceNumber) {
  return (
    String(getRenewalSource(purchase)) === String(sourceNumber) &&
    normalizedStatus(purchase?.paymentStatus) === 'PAID'
  )
}

/* =========================================================
   PREMIUM ESTIMATE

   Matches the current backend calculation:
   - 1 year: no long-term discount.
   - 2–5 years: 5% InsureX discount.
   - HLT- plans: 0% GST.
   - LIF- plans: 0% GST.
   - MTR- plans: 18% GST.

   The backend remains authoritative.
========================================================= */

function roundMoney(amount) {
  return Math.round(
    (Number(amount) + Number.EPSILON) * 100,
  ) / 100
}

function getPlanGstRate(plan) {
  const planCode = String(
    plan?.planCode ?? plan?.code ?? '',
  )
    .trim()
    .toUpperCase()

  if (planCode.startsWith('HLT-')) {
    return 0
  }

  if (planCode.startsWith('LIF-')) {
    return 0
  }

  if (planCode.startsWith('MTR-')) {
    return MOTOR_GST_RATE
  }

  // Match the backend's fail-closed classification.
  // Unknown plan codes must not receive an invented GST rate.
  return null
}

function calculatePremium(plan, coverage, years) {
  const basePremium = Number(plan?.basePremium)
  const baseCoverage = Number(plan?.baseCoverage)
  const requestedCoverage = Number(coverage)
  const duration = Number(years)

  if (
    !Number.isFinite(basePremium) ||
    basePremium <= 0 ||
    !Number.isFinite(baseCoverage) ||
    baseCoverage <= 0 ||
    !Number.isFinite(requestedCoverage) ||
    requestedCoverage <= 0 ||
    !Number.isInteger(duration) ||
    duration < 1 ||
    duration > 5
  ) {
    return null
  }

  const gstRate = getPlanGstRate(plan)

  if (gstRate === null) {
    return null
  }

  // Same proportional coverage calculation as the backend.
  const base = roundMoney(
    basePremium *
    (requestedCoverage / baseCoverage) *
    duration,
  )

  // Backend rule: 5% discount applies only for 2–5 years.
  const discountRate =
    duration >= 2
      ? LONG_TERM_DISCOUNT_RATE
      : 0

  const discount = roundMoney(
    base * discountRate / 100,
  )

  const taxable = roundMoney(base - discount)

  // GST is calculated after applying the discount.
  const gst = roundMoney(
    taxable * gstRate / 100,
  )

  const total = roundMoney(taxable + gst)

  return {
    base,
    discount,
    discountRate,
    taxable,
    gst,
    gstRate,
    total,
    perYear: roundMoney(total / duration),
    isEstimate: true,
  }
}

/* =========================================================
   RAZORPAY LOADER
========================================================= */

let razorpayScriptPromise = null

function loadRazorpay() {
  if (window.Razorpay) {
    return Promise.resolve(window.Razorpay)
  }

  if (razorpayScriptPromise) {
    return razorpayScriptPromise
  }

  razorpayScriptPromise = new Promise((resolve, reject) => {
    let script = document.querySelector(
      `script[src="${RAZORPAY_SCRIPT}"]`,
    )

    const created = !script

    if (!script) {
      script = document.createElement('script')
      script.src = RAZORPAY_SCRIPT
      script.async = true
    }

    const cleanup = () => {
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
    }

    function onLoad() {
      cleanup()

      if (window.Razorpay) {
        resolve(window.Razorpay)
      } else {
        reject(
          new Error(
            'The Razorpay checkout window could not be initialized.',
          ),
        )
      }
    }

    function onError() {
      cleanup()

      if (created) script.remove()

      reject(
        new Error(
          'Could not load Razorpay checkout. Check your internet connection.',
        ),
      )
    }

    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)

    if (created) {
      document.body.appendChild(script)
    } else if (window.Razorpay) {
      onLoad()
    }
  }).catch((error) => {
    razorpayScriptPromise = null
    throw error
  })

  return razorpayScriptPromise
}

/* =========================================================
   ORDER HELPERS

   Preserve the existing backend contract: amount is INR.
========================================================= */

function normalizeOrder(order) {
  return {
    orderId: order?.orderId ?? order?.razorpayOrderId,
    keyId: order?.keyId ?? order?.razorpayKeyId,
    amount: Number(order?.amount ?? order?.totalPremium),
    currency: String(order?.currency || 'INR').toUpperCase(),
  }
}

function validOrder(order) {
  return Boolean(
    order?.orderId &&
    order?.keyId &&
    Number.isFinite(order?.amount) &&
    order.amount > 0 &&
    order.currency === 'INR',
  )
}

function getPurchaseError(error) {
  return errorMessage(
    error,
    'We could not confirm your insurance purchase.',
  )
}

/* =========================================================
   COMPONENT
========================================================= */

export default function BuyPolicy() {
  const { policyNumber: routeId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const isRenewal = location.pathname.startsWith('/app/renew/')
  const originalPolicyNumber = isRenewal ? routeId : null

  /* STATE */

  const [step, setStep] = useState(0)

  const [val, setVal] = useState({
    planId: null,
    coverage: 0,
    years: 1,
  })

  const [nominee, setNominee] = useState({
    name: '',
    relation: '',
    contact: '',
  })

  const [errors, setErrors] = useState({})
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)
  const [paymentUncertain, setPaymentUncertain] = useState(false)
  const [paymentReference, setPaymentReference] = useState(null)

  const paymentLock = useRef(false)

  /* QUERIES */

  const list = useQuery({
    queryKey: ['insurance-plans'],
    queryFn: plans.available,
    staleTime: 60_000,
    retry: 1,
    enabled: !isRenewal,
  })

  const originalPolicyQuery = useQuery({
    queryKey: ['my-policies'],
    queryFn: policies.mine,
    enabled: isRenewal && Boolean(originalPolicyNumber),
    staleTime: 10000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: 1,
  })

  const originalPurchasesQuery = useQuery({
    queryKey: ['my-purchases'],
    queryFn: purchases.mine,
    enabled: isRenewal,
    staleTime: 10000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: 1,
  })

  /* PLAN / ORIGINAL POLICY */

  const catalogue = useMemo(
    () => normalizePlans(list.data).filter(isActivePlan),
    [list.data],
  )

  const policy = useMemo(
    () =>
      catalogue.find(
        (item) => String(item.planId) === String(routeId),
      ) ?? null,
    [catalogue, routeId],
  )

  useEffect(() => {
    if (isRenewal || !policy) return

    const base = Number(policy.baseCoverage)

    if (Number.isFinite(base) && base > 0) {
      setVal({
        planId: String(policy.planId),
        coverage: base,
        years: 1,
      })
    }
  }, [isRenewal, policy?.planId, policy?.baseCoverage])

  const planName =
    policy?.planName || policy?.planCode || 'Insurance plan'

  const selectedCoverage =
    policy && val.planId === String(policy.planId)
      ? Number(val.coverage)
      : Number(policy?.baseCoverage ?? 0)

  const selectedYears =
    policy && val.planId === String(policy.planId)
      ? Number(val.years)
      : 1

  const originalPolicy = useMemo(() => {
    if (!isRenewal) return null

    return (
      normalizeRows(originalPolicyQuery.data).find(
        (item) =>
          String(
            item?.policyNumber ?? item?.policy?.policyNumber,
          ) === String(originalPolicyNumber),
      ) ?? null
    )
  }, [isRenewal, originalPolicyQuery.data, originalPolicyNumber])

  const originalPurchase = useMemo(() => {
    if (!isRenewal) return null

    return (
      normalizeRows(originalPurchasesQuery.data)
        .filter(
          (purchase) =>
            String(extractPolicyNumber(purchase)) ===
              String(originalPolicyNumber) &&
            normalizedStatus(purchase.paymentStatus) === 'PAID',
        )
        .sort(
          (a, b) =>
            Number(b.purchaseId || 0) -
            Number(a.purchaseId || 0),
        )[0] ?? null
    )
  }, [isRenewal, originalPurchasesQuery.data, originalPolicyNumber])

  const alreadyRenewed = useMemo(() => {
    if (!isRenewal) return false

    return normalizeRows(originalPurchasesQuery.data).some(
      (purchase) =>
        isCompletedRenewal(purchase, originalPolicyNumber),
    )
  }, [isRenewal, originalPurchasesQuery.data, originalPolicyNumber])

  /* RENEWAL DATA */

  const renewalCoverage = Number(originalPurchase?.coverageAmount ?? 0)

  const renewalYears = Number(
    originalPolicy?.durationYears ??
    originalPolicy?.policy?.durationYears ??
    originalPurchase?.durationYears ??
    0,
  )

  const renewalPremium = Number(originalPurchase?.totalPremium ?? 0)

  const renewalDetailsReady =
    Number.isFinite(renewalCoverage) &&
    renewalCoverage > 0 &&
    Number.isInteger(renewalYears) &&
    renewalYears > 0 &&
    Number.isFinite(renewalPremium) &&
    renewalPremium > 0

  const coveredType = isRenewal
    ? (
        originalPolicy?.coveredTypes ||
        originalPolicy?.policy?.coveredTypes ||
        originalPurchase?.coveredTypes ||
        'Insurance'
      )
    : (
        policy?.coveredType ||
        policy?.planName ||
        policy?.planCode ||
        'Insurance'
      )

  const planDetails = useMemo(() => {
    if (!isRenewal && policy) {
      return {
        key: null,
        label: policy.planName || policy.planCode || coveredType,
        blurb:
          policy.description ||
          policy.planDescription ||
          policy.coverageDescription ||
          'Insurance coverage designed around your needs.',
      }
    }

    return planFor(coveredType)
  }, [isRenewal, policy, coveredType])

  const est = useMemo(() => {
    if (isRenewal) {
      if (!renewalDetailsReady) return null

      return {
        base: Number(
          originalPurchase?.basePremium ?? renewalPremium,
        ),
        discount: Number(originalPurchase?.discountAmount ?? 0),
        taxable: Number(
          originalPurchase?.taxableAmount ?? renewalPremium,
        ),
        gst: Number(originalPurchase?.gstAmount ?? 0),
        total: renewalPremium,
        perYear: renewalPremium / renewalYears,
      }
    }

    return policy
      ? calculatePremium(policy, selectedCoverage, selectedYears)
      : null
  }, [
    isRenewal,
    renewalDetailsReady,
    originalPurchase,
    renewalPremium,
    renewalYears,
    policy,
    selectedCoverage,
    selectedYears,
  ])

  const effectiveCoverage = isRenewal
    ? renewalCoverage
    : selectedCoverage

  const effectiveYears = isRenewal
    ? renewalYears
    : selectedYears

  const coverageIsValid = isRenewal
    ? renewalDetailsReady
    : Number.isFinite(selectedCoverage) && selectedCoverage > 0

  const durationIsValid = isRenewal
    ? renewalDetailsReady
    : Number.isInteger(selectedYears) &&
      selectedYears >= 1 &&
      selectedYears <= 5

  const blockedRenewal = isRenewal && alreadyRenewed

  /* EFFECTS */

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step])

  useEffect(() => {
    if (!isRenewal || !originalPurchase) return

    setNominee({
      name: originalPurchase.nomineeName || '',
      relation: originalPurchase.nomineeRelation || '',
      contact: originalPurchase.nomineeContact || '',
    })
  }, [isRenewal, originalPurchase])

  /* VALIDATION */

  function validateNominee() {
    const nextErrors = {}

    if (!nominee.name.trim()) {
      nextErrors.name = 'Enter the nominee’s full name.'
    }

    if (!nominee.relation) {
      nextErrors.relation = 'Choose the relationship.'
    }

    if (!/^[6-9]\d{9}$/.test(nominee.contact.trim())) {
      nextErrors.contact =
        'Enter a valid 10-digit mobile number starting with 6–9.'
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  /* RAZORPAY CHECKOUT */

  async function openCheckout(order) {
    const Razorpay = await loadRazorpay()

    return new Promise((resolve, reject) => {
      let settled = false

      function resolveOnce(response) {
        if (settled) return
        settled = true
        resolve(response)
      }

      function rejectOnce(checkoutError) {
        if (settled) return
        settled = true
        reject(checkoutError)
      }

      const checkout = new Razorpay({
        key: order.keyId,
        order_id: order.orderId,

        // Existing backend order contract returns INR.
        amount: Math.round(order.amount * 100),

        currency: order.currency,
        name: 'InsureX',

        description: isRenewal
          ? `Renewal of policy #${originalPolicyNumber}`
          : `${coveredType} · ${inrShort(effectiveCoverage)} · ${effectiveYears} yr`,

        prefill: {
          name: user?.username || '',
          email: user?.email || '',
          contact: user?.contactNumber || '',
        },

        theme: { color: '#17814f' },
        handler: resolveOnce,

        modal: {
          ondismiss: () => {
            rejectOnce(new Error('CHECKOUT_DISMISSED'))
          },
        },
      })

      checkout.on?.('payment.failed', (response) => {
        rejectOnce(
          new Error(
            response?.error?.description || 'Payment failed.',
          ),
        )
      })

      try {
        checkout.open()
      } catch (checkoutError) {
        rejectOnce(checkoutError)
      }
    })
  }

  /* CACHE SYNCHRONIZATION */

  async function refreshRelatedData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['my-purchases'] }),
      queryClient.invalidateQueries({ queryKey: ['my-policies'] }),
      queryClient.invalidateQueries({ queryKey: ['insurance-plans'] }),
      queryClient.invalidateQueries({ queryKey: ['my-claims'] }),
    ])
  }

  /* PAYMENT */

  async function pay() {
    if (paying || paymentLock.current || paymentUncertain || done) {
      return
    }

    setError('')

    if (
      (!isRenewal && !policy) ||
      !est ||
      !coverageIsValid ||
      !durationIsValid
    ) {
      setError(
        'The selected insurance plan, coverage, or duration is invalid.',
      )
      return
    }

    if (blockedRenewal) {
      setError(
        'This policy has already been renewed. Another renewal payment is not allowed.',
      )
      return
    }

    if (!isRenewal && !validateNominee()) {
      setStep(1)
      return
    }

    if (isRenewal && (!originalPolicy || !originalPurchase)) {
      setError('The original policy or paid purchase could not be found.')
      return
    }

    if (!Number.isFinite(est.total) || est.total <= 0) {
      setError('Unable to determine the estimated premium.')
      return
    }

    paymentLock.current = true
    setPaying(true)

    let razorpayResponse = null
    let orderCreated = false
    let checkoutCompleted = false

    try {
      if (isRenewal) {
        const latest = await originalPurchasesQuery.refetch()

        if (latest.error) throw latest.error

        if (
          normalizeRows(latest.data).some((purchase) =>
            isCompletedRenewal(purchase, originalPolicyNumber),
          )
        ) {
          throw new Error(
            'This policy has already been renewed. Please check My Policies.',
          )
        }
      }

      const rawOrder = isRenewal
        ? await renewals.createOrder(originalPolicyNumber)
        : await payment.createOrder({
            planId: Number(policy.planId),
            coverageAmount: selectedCoverage,
            durationYears: selectedYears,
            currency: 'INR',
          })

      orderCreated = true

      const order = normalizeOrder(rawOrder)

      if (!validOrder(order)) {
        throw new Error(
          'The backend returned incomplete payment order details.',
        )
      }

      setPaymentReference({
        orderId: order.orderId,
        paymentId: null,
      })

      if (
        isRenewal &&
        Math.abs(order.amount - renewalPremium) > 0.009
      ) {
        throw new Error(
          'The renewal amount differs from the original paid premium. No checkout was opened.',
        )
      }

      razorpayResponse = await openCheckout(order)
      checkoutCompleted = true

      if (
        !razorpayResponse?.razorpay_order_id ||
        !razorpayResponse?.razorpay_payment_id ||
        !razorpayResponse?.razorpay_signature
      ) {
        throw new Error(
          'Razorpay did not return complete payment confirmation details.',
        )
      }

      if (
        String(razorpayResponse.razorpay_order_id) !==
        String(order.orderId)
      ) {
        throw new Error(
          'The payment order reference does not match the created order.',
        )
      }

      setPaymentReference({
        orderId: order.orderId,
        paymentId: razorpayResponse.razorpay_payment_id,
      })

      // Backend verification is mandatory.
      const saved = isRenewal
        ? await renewals.confirm(originalPolicyNumber, {
            razorpayOrderId: razorpayResponse.razorpay_order_id,
            razorpayPaymentId: razorpayResponse.razorpay_payment_id,
            razorpaySignature: razorpayResponse.razorpay_signature,
          })
        : await purchases.purchase({
            planId: Number(policy.planId),
            coveredTypes: coveredType,
            durationYears: selectedYears,
            coverageAmount: selectedCoverage,
            nomineeName: nominee.name.trim(),
            nomineeRelation: nominee.relation,
            nomineeContact: nominee.contact.trim(),
            paymentMethod: 'RAZORPAY',
            razorpayOrderId: razorpayResponse.razorpay_order_id,
            razorpayPaymentId: razorpayResponse.razorpay_payment_id,
            razorpaySignature: razorpayResponse.razorpay_signature,
          })

      if (!saved || saved.success === false) {
        throw new Error(
          saved?.message ||
          'The backend did not confirm the insurance purchase.',
        )
      }

      setDone(saved)
      setPaymentUncertain(false)

      try {
        await refreshRelatedData()
      } catch (refreshError) {
        // Cache-refresh errors must not undo confirmed payment success.
        console.error('InsureX cache refresh failed:', refreshError)
      }
    } catch (paymentError) {
      const cancelled = paymentError?.message === 'CHECKOUT_DISMISSED'

      if (cancelled) {
        setError(
          'Checkout was closed. If your bank shows a debit, check Payments before trying again.',
        )
      } else if (checkoutCompleted) {
        // Never repeat a purchase call automatically after successful checkout.
        setPaymentUncertain(true)

        setError(
          `${getPurchaseError(paymentError)} ` +
          'Your payment may have succeeded, but the policy confirmation could not be verified. ' +
          'Do not pay again. Check Payments or contact InsureX support.',
        )
      } else {
        const networkUncertain =
          paymentError?.code === 'ERR_NETWORK' ||
          paymentError?.code === 'ECONNABORTED' ||
          paymentError?.code === 'ETIMEDOUT' ||
          (
            paymentError?.response &&
            paymentError.response.status >= 500
          )

        if (!orderCreated && networkUncertain) {
          setPaymentUncertain(true)
        }

        setError(
          errorMessage(
            paymentError,
            'Unable to start or complete checkout.',
          ),
        )
      }
    } finally {
      paymentLock.current = false
      setPaying(false)
    }
  }

  /* SUCCESS */

  if (done) {
    return (
      <div className="ix-buy-page">

        <div className="ix-buy-success">
          <Panel>
            <div className="empty">
              <div className="check-big">
                <Icon name="check" size={32} strokeWidth={3} />
              </div>

              <h4>
                {isRenewal
                  ? 'Policy renewed successfully'
                  : 'You are covered'}
              </h4>

              <p>
                {isRenewal
                  ? `Your original policy #${originalPolicyNumber} remains in your history. Your renewed policy has been recorded.`
                  : `${coveredType} · ${inrShort(effectiveCoverage)} for ${effectiveYears} ${
                      effectiveYears === 1 ? 'year' : 'years'
                    }. Your purchase has been recorded.`}
              </p>

              <dl className="kv ix-success-details">
                <dt>Amount paid</dt>
                <dd>{inr(done.totalPremium ?? est?.total ?? 0)}</dd>

                <dt>Transaction</dt>
                <dd>
                  {done.transactionId ||
                    done.razorpayPaymentId ||
                    paymentReference?.paymentId ||
                    '—'}
                </dd>

                <dt>Paid on</dt>
                <dd>{dateTime(done.paymentDateTime)}</dd>

                <dt>Policy number</dt>
                <dd>
                  {done.policyNumber ??
                    done.policy?.policyNumber ??
                    'Processing'}
                </dd>

                {isRenewal && (
                  <>
                    <dt>Original policy</dt>
                    <dd>#{originalPolicyNumber}</dd>
                  </>
                )}
              </dl>

              <div className="row ix-buy-success-actions">
                <Button
                  variant="dark"
                  onClick={() => navigate('/app/purchases')}
                >
                  See payment details
                </Button>

                <Button onClick={() => navigate('/app/policies')}>
                  My policies
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    )
  }

  /* QUERY STATUS */

  const currentQuery = isRenewal
    ? {
        isLoading:
          originalPolicyQuery.isLoading ||
          originalPurchasesQuery.isLoading,
        isError:
          originalPolicyQuery.isError ||
          originalPurchasesQuery.isError,
        error:
          originalPolicyQuery.error ||
          originalPurchasesQuery.error,
        refetch: async () => {
          await Promise.all([
            originalPolicyQuery.refetch(),
            originalPurchasesQuery.refetch(),
          ])
        },
      }
    : list

  /* RENDER */

  return (
    <div className="ix-buy-page">

      <PageHeader
        title={isRenewal ? 'Renew insurance' : 'Buy insurance'}
        subtitle={
          isRenewal
            ? `Renew policy #${originalPolicyNumber} at the original paid premium`
            : policy
              ? `${planName} · ${coveredType} · ${
                  policy.planCode || `Plan #${policy.planId}`
                }`
              : undefined
        }
      >
        <Link
          className="btn"
          to={isRenewal ? '/app/policies' : '/app/plans'}
        >
          {isRenewal ? 'Back to policies' : 'Back to plans'}
        </Link>
      </PageHeader>

      <div className="ix-buy-hero">
        <ShieldCheck size={27} aria-hidden="true" />
        <div>
          <strong>
            {isRenewal ? 'Secure policy renewal' : 'Secure insurance checkout'}
          </strong>
          <p className="ix-buy-hero-copy">
            {isRenewal
              ? 'Keep your original policy benefits and review your renewal.'
              : 'Choose your cover, confirm nominee details, and pay securely.'}
          </p>
        </div>
      </div>

      <DataState query={currentQuery}>
        {() =>
          (
            (isRenewal && (!originalPurchase || !originalPolicy)) ||
            (!isRenewal && !policy)
          ) ? (
            <div className="alert error" role="alert">
              {isRenewal
                ? 'The original policy or paid purchase could not be found in your account.'
                : 'This insurance plan is not available.'}
            </div>
          ) : blockedRenewal ? (
            <div className="alert info" role="status">
              <ShieldCheck size={18} />
              <span>
                This policy has already been renewed. You can view the renewed
                policy in My Policies.
              </span>
              <Link className="btn" to="/app/policies">
                My policies
              </Link>
            </div>
          ) : !est ? (
            <div className="alert warn" role="alert">
              Unable to determine a valid premium estimate. Please contact support.
            </div>
          ) : (
            <>
              {error && (
                <div className="alert error ix-checkout-alert" role="alert">
                  {error}
                </div>
              )}

              {paymentUncertain && (
                <div className="alert warn ix-checkout-alert" role="alert">
                  <span>
                    Payment confirmation is uncertain. Do not make another
                    payment until you verify the existing transaction.
                  </span>

                  {paymentReference && (
                    <div className="ix-checkout-reference">
                      <div>
                        Order ID: <strong>{paymentReference.orderId || '—'}</strong>
                      </div>

                      {paymentReference.paymentId && (
                        <div>
                          Payment ID: <strong>{paymentReference.paymentId}</strong>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="ix-check-payment-link">
                    <Link className="btn" to="/app/purchases">
                      Check payment history
                    </Link>
                  </div>
                </div>
              )}

              <ol className="steps ix-steps-list">
                {STEPS.map((label, index) => (
                  <li
                    key={label}
                    className={`step ${
                      index === step ? 'active' : index < step ? 'done' : ''
                    }`}
                    aria-current={index === step ? 'step' : undefined}
                  >
                    <span className="n">
                      {index < step ? '✓' : index + 1}
                    </span>
                    {label}
                  </li>
                ))}
              </ol>

              <div className="wizard">
                <div>
                  {/* STEP 1 — COVER */}

                  {step === 0 && (
                    <Panel
                      title={
                        isRenewal
                          ? 'Original policy coverage'
                          : `${planDetails?.label || coveredType} cover`
                      }
                    >
                      <p className="ix-cover-description">
                        {isRenewal
                          ? 'Your renewal keeps the original coverage amount, duration, and paid premium.'
                          : policy.description ||
                            planDetails?.blurb ||
                            'Insurance coverage designed around your needs.'}
                      </p>

                      <dl className="kv">
                        {isRenewal && (
                          <>
                            <dt>Original policy</dt>
                            <dd>#{originalPolicyNumber}</dd>
                          </>
                        )}

                        {!isRenewal && (
                          <>
                            <dt>Selected plan</dt>
                            <dd>{planName}</dd>
                          </>
                        )}

                        <dt>Cover type</dt>
                        <dd>{coveredType}</dd>

                        <dt>Cover amount</dt>
                        <dd>{inr(effectiveCoverage)}</dd>

                        <dt>Term</dt>
                        <dd>{effectiveYears} yr</dd>

                        {!isRenewal && (
                          <>
                            <dt>Plan code</dt>
                            <dd>{policy.planCode || '—'}</dd>

                            <dt>Base premium</dt>
                            <dd>
                              {inr(policy.basePremium)} per{' '}
                              {inr(policy.baseCoverage)} of cover, per year
                            </dd>

                            <dt>InsureX discount ({est.discountRate}%)</dt>
                            <dd>− {inr(est.discount)}</dd>

                            <dt>
                              {est.gstRate === 0
                                ? 'GST (exempt)'
                                : `Estimated GST (${est.gstRate}%)`}
                            </dt>
                            <dd>{inr(est.gst)}</dd>
                          </>
                        )}

                        <dt>Estimated total</dt>
                        <dd>{inr(est.total)}</dd>
                      </dl>

                      <p className="ix-estimate-note">
                        {isRenewal
                          ? 'The renewal amount is based on the original paid purchase. The backend determines the final renewal order amount.'
                          : est.gstRate === 0
                            ? 'GST is estimated at 0% for this qualifying individual health/life plan. Actual tax treatment depends on the policy classification.'
                            : `GST is estimated at ${est.gstRate}% for this motor policy.`}{' '}
                        This is an indicative estimate. The backend determines
                        the actual payment order amount.
                      </p>
                    </Panel>
                  )}

                  {/* STEP 2 — NOMINEE */}

                  {step === 1 && (
                    <Panel title="Nominee details">
                      {isRenewal && (
                        <div className="alert info">
                          Renewal uses the nominee details stored with the
                          original purchase.
                        </div>
                      )}

                      <div className="form-grid">
                        <div className="full">
                          <TextInput
                            label="Nominee’s full name"
                            value={nominee.name}
                            onChange={(event) => {
                              setNominee({
                                ...nominee,
                                name: event.target.value,
                              })
                              setErrors({ ...errors, name: '' })
                            }}
                            error={errors.name}
                            disabled={isRenewal}
                          />
                        </div>

                        <SelectInput
                          label="Relationship"
                          value={nominee.relation}
                          onChange={(event) => {
                            setNominee({
                              ...nominee,
                              relation: event.target.value,
                            })
                            setErrors({ ...errors, relation: '' })
                          }}
                          options={RELATIONS}
                          placeholder="Choose…"
                          error={errors.relation}
                          disabled={isRenewal}
                        />

                        <TextInput
                          label="Nominee’s mobile"
                          inputMode="numeric"
                          maxLength={10}
                          value={nominee.contact}
                          onChange={(event) => {
                            const contact = event.target.value
                              .replace(/\D/g, '')
                              .slice(0, 10)

                            setNominee({ ...nominee, contact })
                            setErrors({ ...errors, contact: '' })
                          }}
                          error={errors.contact}
                          disabled={isRenewal}
                        />
                      </div>
                    </Panel>
                  )}

                  {/* STEP 3 — REVIEW */}

                  {step === 2 && (
                    <Panel title="Review and pay">
                      <dl className="kv">
                        <dt>Purchase type</dt>
                        <dd>{isRenewal ? 'Policy renewal' : 'New insurance'}</dd>

                        {isRenewal && (
                          <>
                            <dt>Original policy</dt>
                            <dd>#{originalPolicyNumber}</dd>
                          </>
                        )}

                        <dt>Insurance</dt>
                        <dd>
                          {isRenewal
                            ? coveredType
                            : `${planName} (${coveredType})`}
                        </dd>

                        <dt>Coverage</dt>
                        <dd>{inr(effectiveCoverage)}</dd>

                        <dt>Term</dt>
                        <dd>{effectiveYears} yr</dd>

                        <dt>Nominee</dt>
                        <dd>
                          {nominee.name || '—'}
                          {nominee.relation ? ` (${nominee.relation})` : ''}
                        </dd>

                        <dt>Nominee mobile</dt>
                        <dd>{nominee.contact || '—'}</dd>

                        {!isRenewal && (
                          <>
                            <dt>Base premium</dt>
                            <dd>{inr(est.base)}</dd>

                            <dt>InsureX discount ({est.discountRate}%)</dt>
                            <dd>− {inr(est.discount)}</dd>

                            <dt>
                              {est.gstRate === 0
                                ? 'GST (exempt)'
                                : `Estimated GST (${est.gstRate}%)`}
                            </dt>
                            <dd>{inr(est.gst)}</dd>
                          </>
                        )}

                        <dt>Estimated total</dt>
                        <dd>{inr(est.total)}</dd>
                      </dl>

                      <div className="alert info ix-payment-info">
                        Payment is processed through Razorpay. The backend
                        verifies the payment before recording the insurance
                        purchase. Do not pay again if you were charged but your
                        policy is not yet visible.
                      </div>
                    </Panel>
                  )}

                  {/* NAVIGATION */}

                  <div className="ix-checkout-actions">
                    {step > 0 && (
                      <Button
                        onClick={() =>
                          setStep((current) => Math.max(0, current - 1))
                        }
                        disabled={paying}
                      >
                        Back
                      </Button>
                    )}

                    {step < 2 ? (
                      <Button
                        variant="dark"
                        disabled={paying || paymentUncertain}
                        onClick={() => {
                          setError('')

                          if (step === 0) {
                            if (!coverageIsValid || !durationIsValid) {
                              setError('Choose valid coverage and duration.')
                              return
                            }

                            setStep(1)
                            return
                          }

                          if (!isRenewal && !validateNominee()) {
                            return
                          }

                          setStep(2)
                        }}
                      >
                        Continue
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        size="lg"
                        loading={paying}
                        disabled={
                          paying ||
                          paymentUncertain ||
                          blockedRenewal ||
                          !coverageIsValid ||
                          !durationIsValid ||
                          !est
                        }
                        onClick={pay}
                      >
                        {isRenewal
                          ? `Renew for ${inr(est.total)}`
                          : `Pay ${inr(est.total)}`}
                      </Button>
                    )}
                  </div>
                </div>

                {/* COVERAGE / PREMIUM CALCULATOR */}

                {!isRenewal && policy && est && (
                  <aside
                    className="ix-original-side ix-coverage-dial"
                    aria-label="Plan and premium calculator"
                  >
                    <CoverageDial
                      value={{
                        coverage: effectiveCoverage,
                        years: effectiveYears,
                      }}
                      onChange={(next) => {
                        setVal((current) => ({
                          ...current,
                          planId: String(policy.planId),
                          coverage: Number(next.coverage),
                          years: Number(next.years),
                        }))
                      }}
                      planLabel={planName}
                      showPlans={false}
                      lockedPlan
                      coverageMin={Math.max(
                        100000,
                        Math.floor(Number(policy.baseCoverage) / 100000) *
                          100000,
                      )}
                      coverageMax={Math.max(
                        5000000,
                        Number(policy.baseCoverage) * 2,
                      )}
                      coverageStep={100000}
                      durationMax={5}
                      premiumEstimate={{
                        ...est,
                        perYear: est.perYear,
                        gstRate: est.gstRate,
                      }}
                    />
                  </aside>
                )}
              </div>
            </>
          )
        }
      </DataState>
    </div>
  )
}
