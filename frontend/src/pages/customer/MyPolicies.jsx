
import { useMemo, useState } from 'react'

import {
  Link,
  useSearchParams,
} from 'react-router-dom'

import { useQuery } from '@tanstack/react-query'

import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  CarFront,
  HeartPulse,
  Users,
} from 'lucide-react'

import {
  claims,
  policies,
  purchases,
} from '../../api/endpoints'

import {
  Button,
  DataState,
  PageHeader,
  Panel,
  Segmented,
  StatusBadge,
  SearchBox,
  useFilter,
} from '../../components/ui'

import { date, today } from '../../lib/format'

import ClaimForm from './ClaimForm'

/* =========================================================
   CONSTANTS
========================================================= */

const FIELDS = [
  'policyNumber',
  'coveredTypes',
  'status',
  'lifecycleStatus',
  'refundStatus',
  'planName',
  'policyType',
  'planType',
  'category',
  'vehicleNumber',
  'registrationNumber',
  'vehicleRegistrationNumber',
  'vehicleModel',
  'makerModel',
]

const SUCCESSFUL_CLAIM_STATUSES = new Set([
  'APPROVED',
  'SETTLED',
])

const PENDING_CLAIM_STATUSES = new Set([
  'PENDING',
  'SUBMITTED',
  'UNDER_REVIEW',
])

const REFUND_PENDING_STATUSES = new Set([
  'REFUND_PENDING',
  'PENDING',
  'REFUND_PROCESSING',
  'PROCESSING',
  'REFUND_REQUIRES_RECONCILIATION',
  'REQUIRES_RECONCILIATION',
])

const REFUNDED_STATUSES = new Set([
  'REFUNDED',
  'FULLY_REFUNDED',
  'PROCESSED',
])

const REFUND_FAILED_STATUSES = new Set([
  'REFUND_FAILED',
  'FAILED',
])

const VALID_FILTERS = new Set([
  'all',
  'active',
  'claimed',
  'renewed',
  'inactive',
  'expired',
])

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'claimed', label: 'Claimed' },
  { value: 'renewed', label: 'Renewed' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'expired', label: 'Expired' },
]

const CATEGORY_OPTIONS = [
  { value: 'all', label: 'All plans' },
  { value: 'health', label: 'Health' },
  { value: 'family', label: 'Family' },
  { value: 'vehicle', label: 'Vehicle' },
]

const REFRESH_INTERVAL = 15000

/* =========================================================
   GENERAL HELPERS
========================================================= */

function normalizedStatus(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
}

function normalizeRows(data) {
  if (Array.isArray(data)) return data

  if (Array.isArray(data?.content)) {
    return data.content
  }

  if (Array.isArray(data?.data)) {
    return data.data
  }

  if (Array.isArray(data?.data?.content)) {
    return data.data.content
  }

  return []
}

function policyNumberOf(value) {
  return (
    value?.policyNumber ??
    value?.policy?.policyNumber ??
    null
  )
}

function claimPolicyNumber(claim) {
  return (
    claim?.policyNumber ??
    claim?.policy?.policyNumber ??
    null
  )
}

function getRenewalSourceNumber(policy) {
  return (
    policy?.renewedFromPolicyNumber ??
    policy?.renewalSourcePolicyNumber ??
    policy?.renewedFromPurchase?.policyNumber ??
    policy?.renewedFromPurchase?.policy?.policyNumber ??
    null
  )
}

function getPurchaseRenewalSource(purchase) {
  return (
    purchase?.renewedFromPolicyNumber ??
    purchase?.renewalSourcePolicyNumber ??
    purchase?.renewedFromPurchase?.policyNumber ??
    purchase?.renewedFromPurchase?.policy?.policyNumber ??
    null
  )
}

function isSuccessfulPurchase(purchase) {
  return normalizedStatus(purchase?.paymentStatus) === 'PAID'
}

/* =========================================================
   PLAN CATEGORY DETECTION

   Uses available policy/plan information.
   Vehicle takes priority over Family, then Health.
========================================================= */

function getPolicyCategory(policy) {
  const values = [
    policy?.category,
    policy?.planCategory,
    policy?.policyCategory,
    policy?.policyType,
    policy?.planType,
    policy?.plan?.category,
    policy?.plan?.planType,
    policy?.plan?.policyType,
    policy?.planName,
    policy?.plan?.name,
    policy?.coveredTypes,
    policy?.coverageType,
    policy?.insuranceType,
    policy?.productType,
  ]

  const text = values
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[_-]/g, ' ')

  // Vehicle-specific details also identify a motor policy.
  const hasVehicleDetails = Boolean(
    policy?.vehicleNumber ||
    policy?.registrationNumber ||
    policy?.vehicleRegistrationNumber ||
    policy?.vehicle?.registrationNumber ||
    policy?.vehicle?.vehicleNumber ||
    policy?.vehicleModel ||
    policy?.makerModel ||
    policy?.vehicle?.model
  )

  if (
    /\b(vehicle|motor|motorcycle|car|bike|two wheeler|four wheeler|automobile)\b/.test(text) ||
    hasVehicleDetails
  ) {
    return 'vehicle'
  }

  if (
    /\b(family|family floater|dependents|dependent)\b/.test(text)
  ) {
    return 'family'
  }

  if (
    /\b(health|medical|hospital|mediclaim)\b/.test(text)
  ) {
    return 'health'
  }

  return 'other'
}

function getVehicleRegistration(policy) {
  return (
    policy?.vehicleRegistrationNumber ??
    policy?.registrationNumber ??
    policy?.vehicleNumber ??
    policy?.vehicle?.registrationNumber ??
    policy?.vehicle?.vehicleNumber ??
    policy?.vehicleDetails?.registrationNumber ??
    null
  )
}

function getVehicleModel(policy) {
  return (
    policy?.vehicleModel ??
    policy?.makerModel ??
    policy?.vehicle?.model ??
    policy?.vehicle?.makerModel ??
    policy?.vehicleDetails?.vehicleModel ??
    null
  )
}

function getCategoryLabel(category) {
  switch (category) {
    case 'health':
      return 'Health Insurance'
    case 'family':
      return 'Family Insurance'
    case 'vehicle':
      return 'Vehicle Insurance'
    default:
      return 'Insurance Policy'
  }
}

/* =========================================================
   REFUND HELPERS
========================================================= */

function getRefundStatus(policy, purchase) {
  const purchaseStatus = normalizedStatus(
    purchase?.refundStatus,
  )

  const policyStatus = normalizedStatus(
    policy?.refundStatus,
  )

  const lifecycleStatus = normalizedStatus(
    policy?.lifecycleStatus,
  )

  if (purchaseStatus && purchaseStatus !== 'NOT_REFUNDED') {
    return purchaseStatus
  }

  if (policyStatus && policyStatus !== 'NOT_REFUNDED') {
    return policyStatus
  }

  if (
    lifecycleStatus.startsWith('REFUND_') ||
    lifecycleStatus === 'REFUNDED'
  ) {
    return lifecycleStatus
  }

  return purchaseStatus || policyStatus || ''
}

function isRefundPending(status) {
  return REFUND_PENDING_STATUSES.has(normalizedStatus(status))
}

function isRefunded(status) {
  return REFUNDED_STATUSES.has(normalizedStatus(status))
}

function isRefundFailed(status) {
  return REFUND_FAILED_STATUSES.has(normalizedStatus(status))
}

function refundStatusLabel(status) {
  switch (normalizedStatus(status)) {
    case 'REFUND_PENDING':
    case 'PENDING':
      return 'Refund pending'

    case 'REFUND_PROCESSING':
    case 'PROCESSING':
      return 'Refund processing'

    case 'REFUND_REQUIRES_RECONCILIATION':
    case 'REQUIRES_RECONCILIATION':
      return 'Under verification'

    case 'REFUNDED':
    case 'FULLY_REFUNDED':
    case 'PROCESSED':
      return 'Refunded'

    case 'REFUND_FAILED':
    case 'FAILED':
      return 'Refund failed'

    default:
      return 'Not refunded'
  }
}

/* =========================================================
   RENEWAL HELPERS
========================================================= */

function isRenewedPolicy(policy, purchase) {
  return (
    getRenewalSourceNumber(policy) != null ||
    getPurchaseRenewalSource(purchase) != null
  )
}

function renewalUrl(policyNumber) {
  return `/app/renew/${encodeURIComponent(String(policyNumber))}`
}

/* =========================================================
   CLAIM HELPERS
========================================================= */

function hasSuccessfulClaim(policy, relatedClaims) {
  if (
    policy?.hasSuccessfulClaim === true ||
    policy?.claimApproved === true
  ) {
    return true
  }

  if (
    SUCCESSFUL_CLAIM_STATUSES.has(
      normalizedStatus(policy?.claimStatus),
    )
  ) {
    return true
  }

  if (
    Array.isArray(policy?.claims) &&
    policy.claims.some((claim) =>
      SUCCESSFUL_CLAIM_STATUSES.has(
        normalizedStatus(claim?.status),
      ),
    )
  ) {
    return true
  }

  return relatedClaims.some((claim) =>
    SUCCESSFUL_CLAIM_STATUSES.has(
      normalizedStatus(claim?.status),
    ),
  )
}

function isPendingClaim(policy, relatedClaims) {
  const embeddedStatuses = Array.isArray(policy?.claims)
    ? policy.claims.map((claim) =>
        normalizedStatus(claim?.status),
      )
    : [normalizedStatus(policy?.claimStatus)]

  return (
    embeddedStatuses.some((status) =>
      PENDING_CLAIM_STATUSES.has(status),
    ) ||
    relatedClaims.some((claim) =>
      PENDING_CLAIM_STATUSES.has(
        normalizedStatus(claim?.status),
      ),
    )
  )
}

/* =========================================================
   POLICY STATUS
========================================================= */

function getPolicyStatus(policy, relatedClaims, relatedPurchase) {
  const backendStatus = normalizedStatus(policy?.status)
  const lifecycleStatus = normalizedStatus(policy?.lifecycleStatus)

  const refundStatus = getRefundStatus(policy, relatedPurchase)

  if (isRefunded(refundStatus) || lifecycleStatus === 'REFUNDED') {
    return 'REFUNDED'
  }

  if (isRefundFailed(refundStatus)) {
    return 'REFUND_FAILED'
  }

  if (isRefundPending(refundStatus) || isRefundPending(lifecycleStatus)) {
    if (
      refundStatus === 'REFUND_REQUIRES_RECONCILIATION' ||
      refundStatus === 'REQUIRES_RECONCILIATION' ||
      lifecycleStatus === 'REFUND_REQUIRES_RECONCILIATION'
    ) {
      return 'REFUND_REQUIRES_RECONCILIATION'
    }

    if (
      refundStatus === 'REFUND_PROCESSING' ||
      refundStatus === 'PROCESSING'
    ) {
      return 'REFUND_PROCESSING'
    }

    return 'REFUND_PENDING'
  }

  if (
    hasSuccessfulClaim(policy, relatedClaims) ||
    backendStatus === 'CLAIMED' ||
    lifecycleStatus === 'CLAIMED'
  ) {
    return 'CLAIMED'
  }

  if (
    backendStatus === 'RENEWED' ||
    lifecycleStatus === 'RENEWED'
  ) {
    return 'RENEWED'
  }

  if (
    lifecycleStatus &&
    !['ACTIVE', 'INACTIVE', 'NEW'].includes(lifecycleStatus)
  ) {
    return lifecycleStatus
  }

  if (
    backendStatus &&
    !['ACTIVE', 'INACTIVE'].includes(backendStatus)
  ) {
    return backendStatus
  }

  if (
    policy?.expiryDate &&
    String(policy.expiryDate).slice(0, 10) <= today()
  ) {
    return 'EXPIRED'
  }

  if (
    backendStatus === 'INACTIVE' ||
    lifecycleStatus === 'INACTIVE' ||
    policy?.isActive === false
  ) {
    return 'INACTIVE'
  }

  return policy?.isActive === true || backendStatus === 'ACTIVE'
    ? 'ACTIVE'
    : 'INACTIVE'
}

/* =========================================================
   STATUS BADGE
========================================================= */

function PolicyStatusBadge({ policy }) {
  const status = policy.displayStatus

  if (status === 'REFUNDED') {
    return <StatusBadge value="REFUNDED" label="Refunded" />
  }

  if (isRefundPending(status)) {
    return (
      <StatusBadge
        value="PENDING"
        label={refundStatusLabel(status)}
      />
    )
  }

  if (isRefundFailed(status)) {
    return <StatusBadge value="FAILED" label="Refund failed" />
  }

  return <StatusBadge value={status} />
}

/* =========================================================
   POLICY ACTION
========================================================= */

function PolicyAction({ policy, onClaim }) {
  if (policy.refundPending || policy.refunded || policy.refundFailed) {
    return (
      <span className="muted ix-policy-action-label">
        {refundStatusLabel(policy.refundStatus)}
      </span>
    )
  }

  if (policy.alreadyRenewed) {
    return (
      <span className="muted ix-policy-action-label">
        Already renewed
      </span>
    )
  }

  if (policy.canRequestRenewal) {
    return (
      <Link
        className="btn primary ix-policy-action-btn"
        to={renewalUrl(policy.policyNumber)}
      >
        <RefreshCw size={15} />
        Renew policy
      </Link>
    )
  }

  return (
    <Button
      size="sm"
      disabled={!policy.canFileClaim}
      title={
        policy.canFileClaim
          ? 'File a claim'
          : policy.pendingClaim
            ? 'A claim is already being processed'
            : policy.displayStatus === 'EXPIRED'
              ? 'Claims cannot be started for an expired policy'
              : policy.isActive === false
                ? 'This policy is not active'
                : 'Claims require an active policy'
      }
      onClick={() => {
        if (policy.canFileClaim) onClaim(policy)
      }}
    >
      {policy.displayStatus === 'EXPIRED'
        ? 'Expired'
        : policy.pendingClaim
          ? 'Claim pending'
          : policy.displayStatus === 'CLAIMED'
            ? 'Claimed'
            : 'File a claim'}
    </Button>
  )
}

/* =========================================================
   CATEGORY ICON
========================================================= */

function CategoryIcon({ category }) {
  if (category === 'vehicle') {
    return <CarFront size={17} />
  }

  if (category === 'family') {
    return <Users size={17} />
  }

  return <HeartPulse size={17} />
}

/* =========================================================
   COMPONENT
========================================================= */

export default function MyPolicies() {
  const [searchParams, setSearchParams] = useSearchParams()

  const requestedFilter = searchParams.get('status') || 'all'

  const status = VALID_FILTERS.has(requestedFilter)
    ? requestedFilter
    : 'all'

  const requestedCategory = searchParams.get('category') || 'all'

  const category = CATEGORY_OPTIONS.some(
    (option) => option.value === requestedCategory,
  )
    ? requestedCategory
    : 'all'

  const claimedSection = status === 'claimed'

  const [claimFor, setClaimFor] = useState(null)
  const [refreshError, setRefreshError] = useState('')

  /* =======================================================
     QUERIES
  ======================================================= */

  const policiesQuery = useQuery({
    queryKey: ['my-policies'],
    queryFn: policies.mine,
    staleTime: 10000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  })

  const claimsQuery = useQuery({
    queryKey: ['my-claims'],
    queryFn: claims.mine,
    staleTime: 15000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })

  const purchasesQuery = useQuery({
    queryKey: ['my-purchases'],
    queryFn: purchases.mine,
    staleTime: 10000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,

    refetchInterval: (query) => {
      const rows = normalizeRows(query.state.data)

      return rows.some((purchase) =>
        isRefundPending(purchase.refundStatus),
      )
        ? REFRESH_INTERVAL
        : false
    },

    refetchIntervalInBackground: false,
  })

  /* =======================================================
     NORMALIZE DATA
  ======================================================= */

  const policyRows = useMemo(
    () => normalizeRows(policiesQuery.data),
    [policiesQuery.data],
  )

  const claimRows = useMemo(
    () => normalizeRows(claimsQuery.data),
    [claimsQuery.data],
  )

  const purchaseRows = useMemo(
    () => normalizeRows(purchasesQuery.data),
    [purchasesQuery.data],
  )

  /* =======================================================
     PAID PURCHASE SYNCHRONIZATION
  ======================================================= */

  const unlinkedPaidPurchases = useMemo(() => {
    const knownPolicyNumbers = new Set(
      policyRows
        .map(policyNumberOf)
        .filter((number) => number != null)
        .map(String),
    )

    return purchaseRows.filter((purchase) => {
      if (!isSuccessfulPurchase(purchase)) return false

      const number = policyNumberOf(purchase)

      return number != null && !knownPolicyNumbers.has(String(number))
    })
  }, [policyRows, purchaseRows])

  /* =======================================================
     INDEX CLAIMS
  ======================================================= */

  const claimsByPolicy = useMemo(() => {
    const map = new Map()

    for (const claim of claimRows) {
      const number = claimPolicyNumber(claim)
      if (number == null) continue

      const key = String(number)

      if (!map.has(key)) map.set(key, [])

      map.get(key).push(claim)
    }

    return map
  }, [claimRows])

  /* =======================================================
     INDEX PURCHASES
  ======================================================= */

  const purchasesByPolicy = useMemo(() => {
    const map = new Map()

    for (const purchase of purchaseRows) {
      const number = policyNumberOf(purchase)
      if (number == null) continue

      const key = String(number)
      const existing = map.get(key)

      if (
        !existing ||
        Number(purchase.purchaseId || 0) >
          Number(existing.purchaseId || 0)
      ) {
        map.set(key, purchase)
      }
    }

    return map
  }, [purchaseRows])

  /* =======================================================
     COMPLETED RENEWALS
  ======================================================= */

  const renewedSourceNumbers = useMemo(() => {
    const set = new Set()

    for (const policy of policyRows) {
      const source = getRenewalSourceNumber(policy)

      if (source != null) set.add(String(source))
    }

    for (const purchase of purchaseRows) {
      const source = getPurchaseRenewalSource(purchase)

      if (source != null && isSuccessfulPurchase(purchase)) {
        set.add(String(source))
      }
    }

    return set
  }, [policyRows, purchaseRows])

  /* =======================================================
     ENRICH POLICIES
  ======================================================= */

  const enrichedPolicies = useMemo(
    () =>
      policyRows.map((policy) => {
        const number = String(policy.policyNumber)

        const relatedClaims = claimsByPolicy.get(number) || []
        const relatedPurchase = purchasesByPolicy.get(number) || null

        const refundStatus = getRefundStatus(policy, relatedPurchase)

        const baseStatus = getPolicyStatus(
          policy,
          relatedClaims,
          relatedPurchase,
        )

        const alreadyRenewed = renewedSourceNumbers.has(number)

        const displayStatus =
          alreadyRenewed &&
          !isRefundPending(baseStatus) &&
          !isRefunded(baseStatus) &&
          !isRefundFailed(baseStatus)
            ? 'RENEWED'
            : baseStatus

        const hasClaimHistory =
          relatedClaims.length > 0 ||
          (Array.isArray(policy.claims) && policy.claims.length > 0) ||
          policy.hasSuccessfulClaim === true ||
          policy.claimApproved === true ||
          Boolean(normalizedStatus(policy.claimStatus)) ||
          normalizedStatus(policy.status) === 'CLAIMED' ||
          normalizedStatus(policy.lifecycleStatus) === 'CLAIMED'

        const claimCount =
          relatedClaims.length ||
          (Array.isArray(policy.claims) ? policy.claims.length : 0)

        const pendingClaim = isPendingClaim(policy, relatedClaims)

        const renewalChild = isRenewedPolicy(policy, relatedPurchase)

        const refundPending =
          !isRefundFailed(refundStatus) &&
          !isRefunded(refundStatus) &&
          (
            isRefundPending(refundStatus) ||
            isRefundPending(policy.lifecycleStatus)
          )

        const refunded =
          isRefunded(refundStatus) ||
          normalizedStatus(policy.lifecycleStatus) === 'REFUNDED'

        const refundFailed =
          isRefundFailed(refundStatus) ||
          normalizedStatus(policy.lifecycleStatus) === 'REFUND_FAILED'

        const coverageCurrentlyValid =
          Boolean(policy.startDate && policy.expiryDate) &&
          String(policy.startDate).slice(0, 10) <= today() &&
          String(policy.expiryDate).slice(0, 10) > today()

        const coverageActive =
          policy.isActive === true &&
          ['', 'ACTIVE'].includes(
            normalizedStatus(policy.lifecycleStatus),
          ) &&
          coverageCurrentlyValid &&
          !alreadyRenewed &&
          !refundPending &&
          !refunded &&
          !refundFailed

        const canFileClaim =
          coverageActive &&
          !pendingClaim &&
          !hasSuccessfulClaim(policy, relatedClaims)

        const canRequestRenewal =
          displayStatus === 'CLAIMED' &&
          !alreadyRenewed &&
          !renewalChild &&
          relatedPurchase != null &&
          isSuccessfulPurchase(relatedPurchase) &&
          !refundPending &&
          !refunded &&
          !refundFailed

        const planCategory = getPolicyCategory(policy)

        return {
          ...policy,
          displayStatus,
          refundStatus,
          refundPending,
          refunded,
          refundFailed,
          pendingClaim,
          hasClaimHistory,
          claimCount,
          alreadyRenewed,
          renewalChild,
          coverageActive,
          canFileClaim,
          canRequestRenewal,
          planCategory,
          categoryLabel: getCategoryLabel(planCategory),
          vehicleRegistration: getVehicleRegistration(policy),
          vehicleModel: getVehicleModel(policy),
        }
      }),
    [
      policyRows,
      claimsByPolicy,
      purchasesByPolicy,
      renewedSourceNumbers,
    ],
  )

  /* =======================================================
     SEARCH
  ======================================================= */

  const [search, setSearch, searched] = useFilter(
    enrichedPolicies,
    FIELDS,
  )

  /* =======================================================
     CATEGORY FILTER
  ======================================================= */

  const categoryRows = useMemo(
    () =>
      (searched || []).filter((policy) =>
        category === 'all'
          ? true
          : policy.planCategory === category,
      ),
    [searched, category],
  )

  /* =======================================================
     STATUS FILTER
  ======================================================= */

  const rows = useMemo(
    () =>
      categoryRows.filter((policy) => {
        if (status === 'all') return true

        if (status === 'renewed') {
          return policy.displayStatus === 'RENEWED'
        }

        if (status === 'active') {
          return policy.coverageActive
        }

        if (status === 'claimed') {
          return policy.hasClaimHistory
        }

        return policy.displayStatus === status.toUpperCase()
      }),
    [categoryRows, status],
  )

  /* =======================================================
     URL FILTERS
  ======================================================= */

  function updateFilters(nextStatus, nextCategory) {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous)

      if (nextStatus === 'all') {
        next.delete('status')
      } else {
        next.set('status', nextStatus)
      }

      if (nextCategory === 'all') {
        next.delete('category')
      } else {
        next.set('category', nextCategory)
      }

      return next
    })
  }

  function changeStatus(nextStatus) {
    if (!VALID_FILTERS.has(nextStatus)) return

    updateFilters(nextStatus, category)
  }

  function changeCategory(nextCategory) {
    if (!CATEGORY_OPTIONS.some((item) => item.value === nextCategory)) {
      return
    }

    updateFilters(status, nextCategory)
  }

  /* =======================================================
     SUMMARY
  ======================================================= */

  const summary = useMemo(
    () => ({
      total: enrichedPolicies.length,

      active: enrichedPolicies.filter(
        (policy) => policy.coverageActive,
      ).length,

      claimed: enrichedPolicies.filter(
        (policy) => policy.hasClaimHistory,
      ).length,

      linkedClaims: claimRows.filter((claim) =>
        enrichedPolicies.some(
          (policy) =>
            String(policy.policyNumber) ===
            String(claimPolicyNumber(claim)),
        ),
      ).length,

      renewed: enrichedPolicies.filter(
        (policy) => policy.displayStatus === 'RENEWED',
      ).length,

      refunds: enrichedPolicies.filter(
        (policy) => policy.refundPending,
      ).length,

      health: enrichedPolicies.filter(
        (policy) => policy.planCategory === 'health',
      ).length,

      family: enrichedPolicies.filter(
        (policy) => policy.planCategory === 'family',
      ).length,

      vehicle: enrichedPolicies.filter(
        (policy) => policy.planCategory === 'vehicle',
      ).length,
    }),
    [enrichedPolicies, claimRows],
  )

  /* =======================================================
     REFRESH
  ======================================================= */

  const refreshing =
    policiesQuery.isFetching ||
    claimsQuery.isFetching ||
    purchasesQuery.isFetching

  async function refreshAll() {
    setRefreshError('')

    try {
      const results = await Promise.all([
        policiesQuery.refetch(),
        claimsQuery.refetch(),
        purchasesQuery.refetch(),
      ])

      const failure = results.find((result) => result.error)

      if (failure) throw failure.error
    } catch (error) {
      setRefreshError(
        error?.response?.data?.message ||
        error?.message ||
        'Unable to refresh policy information.',
      )
    }
  }

  const query = {
    ...policiesQuery,

    isLoading:
      policiesQuery.isLoading ||
      claimsQuery.isLoading ||
      purchasesQuery.isLoading,

    isError:
      policiesQuery.isError ||
      claimsQuery.isError ||
      purchasesQuery.isError,

    error:
      policiesQuery.error ||
      claimsQuery.error ||
      purchasesQuery.error,

    refetch: refreshAll,
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <PageHeader
        title={claimedSection ? 'Claimed policies' : 'My policies'}
        subtitle={
          claimedSection
            ? 'Review policies with claim history, including policies renewed after a claim.'
            : 'Manage your Health, Family and Vehicle insurance coverage, claims and renewals.'
        }
      >
        <Link className="btn primary" to="/app/plans">
          Buy insurance
        </Link>
      </PageHeader>

      {/* SUMMARY */}

      {claimedSection ? (
        <div className="ix-policy-summary-grid">
          <Panel>
            <div className="ix-policy-summary-card">
              <ShieldCheck size={22} />
              <div>
                <div className="muted">Policies with claims</div>
                <strong>{query.isLoading ? '…' : summary.claimed}</strong>
              </div>
            </div>
          </Panel>

          <Panel>
            <div className="ix-policy-summary-card">
              <CheckCircle2 size={22} />
              <div>
                <div className="muted">Linked claims</div>
                <strong>{query.isLoading ? '…' : summary.linkedClaims}</strong>
              </div>
            </div>
          </Panel>

          <Panel>
            <div className="ix-policy-summary-card">
              <RefreshCw size={22} />
              <div>
                <div className="muted">Renewed after claim</div>
                <strong>
                  {query.isLoading
                    ? '…'
                    : enrichedPolicies.filter(
                        (policy) =>
                          policy.hasClaimHistory &&
                          policy.alreadyRenewed,
                      ).length}
                </strong>
              </div>
            </div>
          </Panel>
        </div>
      ) : (
        <>
          <div className="ix-policy-summary-grid">
            <Panel>
              <div className="ix-policy-summary-card">
                <ShieldCheck size={22} />
                <div>
                  <div className="muted">Total policies</div>
                  <strong>{query.isLoading ? '…' : summary.total}</strong>
                </div>
              </div>
            </Panel>

            <Panel>
              <div className="ix-policy-summary-card">
                <CheckCircle2 size={22} />
                <div>
                  <div className="muted">Active</div>
                  <strong>{query.isLoading ? '…' : summary.active}</strong>
                </div>
              </div>
            </Panel>

            <Panel>
              <div className="ix-policy-summary-card">
                <RefreshCw size={22} />
                <div>
                  <div className="muted">Renewed</div>
                  <strong>{query.isLoading ? '…' : summary.renewed}</strong>
                </div>
              </div>
            </Panel>

            <Panel>
              <div className="ix-policy-summary-card">
                <RotateCcw size={22} />
                <div>
                  <div className="muted">Pending refunds</div>
                  <strong>{query.isLoading ? '…' : summary.refunds}</strong>
                </div>
              </div>
            </Panel>
          </div>

          {/* PLAN CATEGORY SUMMARY */}

          <div className="ix-policy-category-summary">
            <Panel>
              <div className="ix-policy-category-item">
                <HeartPulse size={20} />
                <div>
                  <span>Health</span>
                  <strong>{query.isLoading ? '…' : summary.health}</strong>
                </div>
              </div>
            </Panel>

            <Panel>
              <div className="ix-policy-category-item">
                <Users size={20} />
                <div>
                  <span>Family</span>
                  <strong>{query.isLoading ? '…' : summary.family}</strong>
                </div>
              </div>
            </Panel>

            <Panel>
              <div className="ix-policy-category-item">
                <CarFront size={20} />
                <div>
                  <span>Vehicle</span>
                  <strong>{query.isLoading ? '…' : summary.vehicle}</strong>
                </div>
              </div>
            </Panel>
          </div>
        </>
      )}

      {/* UNLINKED PURCHASE NOTICE */}

      {!query.isLoading &&
        !query.isError &&
        unlinkedPaidPurchases.length > 0 && (
          <div className="alert info ix-policy-alert" role="status">
            <Clock3 size={17} />
            <span>
              {unlinkedPaidPurchases.length} paid{' '}
              {unlinkedPaidPurchases.length === 1
                ? 'purchase has'
                : 'purchases have'}{' '}
              a policy number missing from the policy history response.
              Refresh after deploying the backend history fix.
            </span>
            <Button
              size="sm"
              onClick={refreshAll}
              disabled={refreshing}
            >
              <RefreshCw size={15} />
              Refresh
            </Button>
          </div>
        )}

      {/* REFUND NOTICE */}

      {summary.refunds > 0 && (
        <div className="alert info ix-policy-alert" role="status">
          <Clock3 size={17} />
          <span>
            {summary.refunds} policy
            {summary.refunds === 1 ? ' has' : ' policies have'} a refund
            awaiting processing or verification. Refund information
            refreshes automatically.
          </span>
        </div>
      )}

      {refreshError && (
        <div className="alert error ix-policy-alert" role="alert">
          <AlertCircle size={17} />
          <span>{refreshError}</span>
        </div>
      )}

      {/* POLICIES */}

      <Panel flush>
        <div className="toolbar ix-policy-toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search policy, plan or vehicle number"
          />

          <Button onClick={refreshAll} disabled={refreshing}>
            <RefreshCw size={15} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>

        {/* CATEGORY FILTER */}

        <div className="ix-policy-filter-section">
          <div className="ix-policy-filter-label">
            Insurance category
          </div>

          <Segmented
            value={category}
            onChange={changeCategory}
            options={CATEGORY_OPTIONS}
          />
        </div>

        {/* STATUS FILTER */}

        {!claimedSection && (
          <div className="ix-policy-filter-section">
            <div className="ix-policy-filter-label">
              Policy status
            </div>

            <Segmented
              value={status}
              onChange={changeStatus}
              options={FILTER_OPTIONS}
            />
          </div>
        )}

        <DataState
          query={query}
          empty={{
            title: 'No policies yet',
            text: 'Once you buy an insurance plan, it will appear here.',
          }}
          emptyAction={
            <Link className="btn primary" to="/app/plans">
              Browse plans
            </Link>
          }
        >
          {() =>
            rows.length === 0 ? (
              <div className="empty">
                <h4>
                  {claimedSection
                    ? 'No claimed policies found'
                    : 'No matching policies'}
                </h4>

                <p>
                  {claimedSection
                    ? 'Policies with claims will appear here. Try clearing your search.'
                    : 'Try another category, search or status filter.'}
                </p>
              </div>
            ) : claimedSection ? (
              <div
                className="ix-claimed-list"
                aria-label="Claimed policy history"
              >
                {rows.map((policy) => (
                  <article
                    className="ix-claimed-card"
                    key={String(policy.policyNumber)}
                  >
                    <div className="ix-claimed-top">
                      <div>
                        <div className="muted">Insurance policy</div>
                        <strong>#{policy.policyNumber}</strong>
                      </div>

                      <PolicyStatusBadge policy={policy} />
                    </div>

                    <div className="ix-claimed-meta">
                      <div>
                        <small>Plan category</small>
                        <b>{policy.categoryLabel}</b>
                      </div>

                      <div>
                        <small>Claims recorded</small>
                        <b>
                          {policy.claimCount ||
                            (policy.hasClaimHistory ? 'Recorded' : '0')}
                        </b>
                      </div>

                      <div>
                        <small>Started</small>
                        <b>{date(policy.startDate)}</b>
                      </div>

                      <div>
                        <small>Expires</small>
                        <b>{date(policy.expiryDate)}</b>
                      </div>
                    </div>

                    <div className="ix-claimed-footer">
                      <span className="muted">
                        {policy.alreadyRenewed
                          ? 'Renewal completed'
                          : 'Claim history available'}
                      </span>

                      <Link
                        className="btn primary ix-policy-action-btn"
                        to="/app/claims"
                      >
                        View claims
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div
                className="ix-policy-card-grid"
                aria-label="My policies"
              >
                {rows.map((policy) => (
                  <article
                    className="ix-policy-card"
                    key={String(policy.policyNumber)}
                  >
                    <div className="ix-policy-card-head">
                      <div className="ix-policy-card-identity">
                        <span className="ix-policy-eyebrow">
                          {policy.categoryLabel}
                        </span>

                        <h3>#{policy.policyNumber}</h3>

                        <span className="ix-policy-cover">
                          {policy.coveredTypes || 'Insurance cover'}
                        </span>
                      </div>

                      <PolicyStatusBadge policy={policy} />
                    </div>

                    {/* CATEGORY ICON AND VEHICLE DETAILS */}

                    <div className="ix-policy-category-line">
                      <CategoryIcon category={policy.planCategory} />

                      <span>{policy.categoryLabel}</span>
                    </div>

                    {policy.planCategory === 'vehicle' && (
                      <div className="ix-policy-vehicle-details">
                        <div>
                          <span>Registration number</span>
                          <strong>
                            {policy.vehicleRegistration || 'Not provided'}
                          </strong>
                        </div>

                        <div>
                          <span>Vehicle model</span>
                          <strong>
                            {policy.vehicleModel || 'Not provided'}
                          </strong>
                        </div>
                      </div>
                    )}

                    <div className="ix-policy-card-details">
                      <div>
                        <span>Start date</span>
                        <strong>{date(policy.startDate)}</strong>
                      </div>

                      <div>
                        <span>Expiry date</span>
                        <strong>{date(policy.expiryDate)}</strong>
                      </div>

                      <div>
                        <span>Policy term</span>
                        <strong>
                          {policy.durationYears != null
                            ? `${policy.durationYears} yr`
                            : '—'}
                        </strong>
                      </div>

                      <div>
                        <span>Claims recorded</span>
                        <strong>
                          {policy.claimCount ||
                            (policy.hasClaimHistory ? 'Recorded' : '0')}
                        </strong>
                      </div>
                    </div>

                    <div className="ix-policy-card-footer">
                      <span className="ix-policy-card-hint">
                        {policy.alreadyRenewed
                          ? 'Previous cover renewed'
                          : policy.refundPending
                            ? 'Refund pending or processing'
                            : policy.pendingClaim
                              ? 'Claim under review'
                              : policy.coverageActive
                                ? 'Coverage currently active'
                                : 'Policy details'}
                      </span>

                      <PolicyAction
                        policy={policy}
                        onClaim={setClaimFor}
                      />
                    </div>
                  </article>
                ))}
              </div>
            )
          }
        </DataState>
      </Panel>

      {/* CLAIM FORM */}

      {claimFor && (
        <ClaimForm
          policy={claimFor}
          onClose={() => setClaimFor(null)}
        />
      )}
    </>
  )
}
