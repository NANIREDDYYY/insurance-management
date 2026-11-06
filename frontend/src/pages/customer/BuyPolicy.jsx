
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
  vehicleVerification,
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

const GENDERS = ['Male', 'Female', 'Other']

const OCCUPATIONS = [
  'Salaried',
  'Self-employed',
  'Business',
  'Government employee',
  'Professional',
  'Student',
  'Homemaker',
  'Retired',
  'Other',
]

const FUEL_TYPES = [
  'Petrol',
  'Diesel',
  'Electric',
  'CNG',
  'Hybrid',
  'Other',
]

const VEHICLE_USAGES = [
  'Personal',
  'Commercial',
]

const YES_NO = ['Yes', 'No']

const STEPS = [
  'Cover',
  'Application details',
  'Nominee',
  'Review and pay',
]

const RENEWAL_STEPS = [
  'Cover',
  'Nominee',
  'Review and pay',
]

const RAZORPAY_SCRIPT =
  'https://checkout.razorpay.com/v1/checkout.js'

const LONG_TERM_DISCOUNT_RATE = 5
const MOTOR_GST_RATE = 18

const inputStyle = {
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  padding: '11px 12px',
  border: '1px solid #d6e0dc',
  borderRadius: '9px',
  background: '#fff',
  color: '#172b23',
  fontSize: '14px',
  outlineColor: '#17814f',
}

const labelStyle = {
  display: 'block',
  marginBottom: '6px',
  color: '#34483e',
  fontSize: '13px',
  fontWeight: 600,
}

const fieldWrapperStyle = {
  minWidth: 0,
  marginBottom: '15px',
}

const errorStyle = {
  display: 'block',
  color: '#c0392b',
  fontSize: '12px',
  marginTop: '5px',
}

/* =========================================================
   INLINE APPLICATION FIELD
========================================================= */

function ApplicationField({
  label,
  name,
  value,
  onChange,
  error,
  type = 'text',
  options = [],
  placeholder = 'Enter here',
  required = false,
  disabled = false,
  min,
  max,
  maxLength,
}) {
  const commonProps = {
    name,
    value: value ?? '',
    disabled,
    required,
    style: {
      ...inputStyle,
      borderColor: error ? '#dc5b55' : '#d6e0dc',
      opacity: disabled ? 0.65 : 1,
    },
    onChange: (event) => onChange(name, event.target.value),
  }

  return (
    <div style={fieldWrapperStyle}>
      <label htmlFor={`application-${name}`} style={labelStyle}>
        {label}
        {required && <span style={{ color: '#dc5b55' }}> *</span>}
      </label>

      {type === 'textarea' ? (
        <textarea
          id={`application-${name}`}
          {...commonProps}
          rows={3}
          placeholder={placeholder}
          maxLength={maxLength}
          style={{
            ...commonProps.style,
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
      ) : type === 'select' ? (
        <select id={`application-${name}`} {...commonProps}>
          <option value="">Choose...</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={`application-${name}`}
          {...commonProps}
          type={type}
          placeholder={placeholder}
          min={min}
          max={max}
          maxLength={maxLength}
        />
      )}

      {error && <span style={errorStyle}>{error}</span>}
    </div>
  )
}

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

function normalizeRegistration(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '')
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
   PLAN CLASSIFICATION
========================================================= */

function getPlanCategory(plan) {
  const code = String(
    plan?.planCode ?? plan?.code ?? '',
  ).trim().toUpperCase()

  if (code.startsWith('HLT-')) return 'HEALTH'
  if (code.startsWith('LIF-')) return 'LIFE'
  if (code.startsWith('MTR-')) return 'MOTOR'

  const text = String(
    plan?.coveredType ?? plan?.planName ?? '',
  ).toLowerCase()

  if (text.includes('health')) return 'HEALTH'
  if (text.includes('life')) return 'LIFE'
  if (
    text.includes('motor') ||
    text.includes('car') ||
    text.includes('vehicle') ||
    text.includes('bike')
  ) return 'MOTOR'

  return ''
}

function isFamilyPlan(plan) {
  const code = String(
    plan?.planCode ?? plan?.code ?? '',
  ).trim().toUpperCase()

  return [
    'HLT-FAMILY',
    'LIF-FAMILY',
  ].includes(code)
}

function createInitialApplicationDetails() {
  return {
    applicantName: '',
    dateOfBirth: '',
    gender: '',
    occupation: '',

    heightCm: '',
    weightKg: '',
    hasPreExistingDisease: '',
    preExistingDiseases: '',
    medicalHistory: '',
    takingMedication: '',
    medicationDetails: '',

    annualIncome: '',
    smokingStatus: '',
    alcoholConsumption: '',
    hazardousActivities: '',
    existingMedicalConditions: '',
    familyMedicalHistory: '',

    registrationNumber: '',
    ownerName: '',
    vehicleMake: '',
    vehicleModel: '',
    vehicleVariant: '',
    manufacturingYear: '',
    fuelType: '',
    vehicleState: '',
    vehicleRto: '',
    insuranceValidity: '',
    vehicleUsage: '',
    previousInsurance: '',
    previousInsurer: '',
    previousPolicyNumber: '',
    previousPolicyExpiryDate: '',
    previousClaims: '',
    claimDetails: '',
  }
}

function createEmptyFamilyMember() {
  return {
    name: '',
    relation: '',
    dateOfBirth: '',
    gender: '',
    occupation: '',
  }
}

/* =========================================================
   PREMIUM ESTIMATE
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

  if (planCode.startsWith('HLT-')) return 0
  if (planCode.startsWith('LIF-')) return 0
  if (planCode.startsWith('MTR-')) return MOTOR_GST_RATE

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

  if (gstRate === null) return null

  const base = roundMoney(
    basePremium *
      (requestedCoverage / baseCoverage) *
      duration,
  )

  const discountRate =
    duration >= 2
      ? LONG_TERM_DISCOUNT_RATE
      : 0

  const discount = roundMoney(
    (base * discountRate) / 100,
  )

  const taxable = roundMoney(base - discount)

  const gst = roundMoney(
    (taxable * gstRate) / 100,
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

function displayLabel(value) {
  return String(value || '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (character) => character.toUpperCase())
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

  const [applicationDetails, setApplicationDetails] = useState(
    createInitialApplicationDetails,
  )

  const [rcVerification, setRcVerification] = useState({
    loading: false,
    verifiedRegistration: '',
    result: null,
    error: '',
  })

  const [familyMembers, setFamilyMembers] = useState([])

  const [errors, setErrors] = useState({})
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)
  const [paymentUncertain, setPaymentUncertain] = useState(false)
  const [paymentReference, setPaymentReference] = useState(null)

  const paymentLock = useRef(false)
  const rcRequestId = useRef(0)

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
        discountRate:
          Number(originalPurchase?.discountAmount ?? 0) > 0 ? 5 : 0,
        taxable: Number(
          originalPurchase?.taxableAmount ?? renewalPremium,
        ),
        gst: Number(originalPurchase?.gstAmount ?? 0),
        gstRate: null,
        total: renewalPremium,
        perYear: roundMoney(renewalPremium / renewalYears),
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

  /* APPLICATION CATEGORY */

  const planCategory = useMemo(
    () => getPlanCategory(policy),
    [policy],
  )

  const familyPlan = useMemo(
    () => isFamilyPlan(policy),
    [policy],
  )

  const applicationStepLabel = isRenewal
    ? RENEWAL_STEPS
    : STEPS

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

  /* =========================================================
     AUTOMATIC VEHICLE RC VERIFICATION
  ========================================================= */

  async function verifyVehicleRegistration(registrationValue) {
    const registrationNumber = normalizeRegistration(
      registrationValue,
    )

    if (!/^[A-Z0-9]{6,15}$/.test(registrationNumber)) {
      return
    }

    const requestId = ++rcRequestId.current

    setRcVerification({
      loading: true,
      verifiedRegistration: '',
      result: null,
      error: '',
    })

    try {
      const response = await vehicleVerification.verify(
        registrationNumber,
      )

      // Ignore an older request if the registration number changed.
      if (requestId !== rcRequestId.current) return

      if (
        !response ||
        String(response.status ?? '').toLowerCase() !== 'success'
      ) {
        throw new Error(
          response?.message ||
          'Vehicle details could not be retrieved.',
        )
      }

      const verifiedNumber = normalizeRegistration(
        response.registrationNumber || registrationNumber,
      )

      if (verifiedNumber !== registrationNumber) {
        throw new Error(
          'The returned registration number does not match.',
        )
      }

      const vehicle = String(response.vehicle || '').trim()
      const owner = String(response.ownerName || '').trim()
      const fuel = String(response.fuel || '').trim()
      const state = String(response.state || '').trim()
      const rto = String(response.rto || '').trim()

      const matchingFuel = FUEL_TYPES.find(
        (item) =>
          item.toLowerCase() === fuel.toLowerCase(),
      )

      setApplicationDetails((current) => ({
        ...current,

        // Only fill information actually returned by API Express.
        ownerName: owner || current.ownerName,
        vehicleModel: vehicle || current.vehicleModel,
        fuelType: matchingFuel || current.fuelType,
        vehicleState: state || current.vehicleState,
        vehicleRto: rto || current.vehicleRto,

        insuranceValidity:
          typeof response.insuranceValid === 'boolean'
            ? response.insuranceValid
              ? 'Valid'
              : 'Not valid'
            : current.insuranceValidity,
      }))

      setRcVerification({
        loading: false,
        verifiedRegistration: verifiedNumber,
        result: response,
        error: '',
      })

    } catch (verificationError) {
      if (requestId !== rcRequestId.current) return

      setRcVerification({
        loading: false,
        verifiedRegistration: '',
        result: null,
        error: errorMessage(
          verificationError,
          'Unable to retrieve vehicle details. You can enter them manually.',
        ),
      })
    }
  }

  /* =========================================================
     AUTOMATIC LOOKUP AFTER CUSTOMER STOPS TYPING
  ========================================================= */

  useEffect(() => {
    if (planCategory !== 'MOTOR') return

    const registrationNumber = normalizeRegistration(
      applicationDetails.registrationNumber,
    )

    if (!/^[A-Z0-9]{6,15}$/.test(registrationNumber)) {
      rcRequestId.current += 1

      setRcVerification({
        loading: false,
        verifiedRegistration: '',
        result: null,
        error: '',
      })

      return
    }

    const timeoutId = window.setTimeout(() => {
      verifyVehicleRegistration(registrationNumber)
    }, 700)

    return () => {
      window.clearTimeout(timeoutId)
      rcRequestId.current += 1
    }
  }, [
    applicationDetails.registrationNumber,
    planCategory,
  ])

  /* APPLICATION STATE HELPERS */

  function updateApplicationField(name, value) {
    setApplicationDetails((current) => ({
      ...current,
      [name]: name === 'registrationNumber'
        ? value.toUpperCase()
        : value,
    }))

    setErrors((current) => ({
      ...current,
      [name]: '',
      ...(name === 'registrationNumber'
        ? { vehicleVerification: '' }
        : {}),
    }))

    if (name === 'registrationNumber') {
      rcRequestId.current += 1

      setRcVerification({
        loading: false,
        verifiedRegistration: '',
        result: null,
        error: '',
      })
    }
  }

  function updateFamilyMember(index, name, value) {
    setFamilyMembers((current) =>
      current.map((member, memberIndex) =>
        memberIndex === index
          ? { ...member, [name]: value }
          : member,
      ),
    )

    setErrors((current) => ({
      ...current,
      [`family-${index}-${name}`]: '',
    }))
  }

  function addFamilyMember() {
    setFamilyMembers((current) => [
      ...current,
      createEmptyFamilyMember(),
    ])
  }

  function removeFamilyMember(index) {
    setFamilyMembers((current) =>
      current.filter((_, memberIndex) => memberIndex !== index),
    )
  }

  /* =========================================================
     VALIDATION
  ========================================================= */

  function validateApplication() {
    const nextErrors = {}
    const details = applicationDetails

    if (!planCategory) {
      nextErrors.application =
        'The selected plan category could not be identified.'
    }

    if (planCategory === 'HEALTH') {
      if (!details.applicantName.trim()) {
        nextErrors.applicantName = 'Enter the applicant’s full name.'
      }

      if (!details.dateOfBirth) {
        nextErrors.dateOfBirth = 'Select the date of birth.'
      }

      if (!details.gender) {
        nextErrors.gender = 'Select gender.'
      }

      if (!details.occupation) {
        nextErrors.occupation = 'Select occupation.'
      }

      if (!details.hasPreExistingDisease) {
        nextErrors.hasPreExistingDisease =
          'Please answer this question.'
      }

      if (
        details.hasPreExistingDisease === 'Yes' &&
        !details.preExistingDiseases.trim()
      ) {
        nextErrors.preExistingDiseases =
          'Describe the existing medical conditions.'
      }

      if (!details.medicalHistory.trim()) {
        nextErrors.medicalHistory =
          'Provide a brief medical history. Enter None if not applicable.'
      }

      if (!details.takingMedication) {
        nextErrors.takingMedication =
          'Please answer this question.'
      }

      if (
        details.takingMedication === 'Yes' &&
        !details.medicationDetails.trim()
      ) {
        nextErrors.medicationDetails =
          'Provide medication details.'
      }

      if (
        details.heightCm &&
        (
          Number(details.heightCm) < 30 ||
          Number(details.heightCm) > 250
        )
      ) {
        nextErrors.heightCm = 'Enter a valid height in centimetres.'
      }

      if (
        details.weightKg &&
        (
          Number(details.weightKg) < 2 ||
          Number(details.weightKg) > 400
        )
      ) {
        nextErrors.weightKg = 'Enter a valid weight in kilograms.'
      }
    }

    if (planCategory === 'LIFE') {
      if (!details.applicantName.trim()) {
        nextErrors.applicantName =
          'Enter the life assured’s full name.'
      }

      if (!details.dateOfBirth) {
        nextErrors.dateOfBirth = 'Select the date of birth.'
      }

      if (!details.gender) {
        nextErrors.gender = 'Select gender.'
      }

      if (!details.occupation) {
        nextErrors.occupation = 'Select occupation.'
      }

      if (
        !details.annualIncome ||
        Number(details.annualIncome) <= 0
      ) {
        nextErrors.annualIncome =
          'Enter a valid annual income.'
      }

      if (!details.smokingStatus) {
        nextErrors.smokingStatus =
          'Select your smoking status.'
      }

      if (!details.alcoholConsumption) {
        nextErrors.alcoholConsumption =
          'Select your alcohol consumption status.'
      }

      if (!details.hazardousActivities) {
        nextErrors.hazardousActivities =
          'Please answer this question.'
      }

      if (!details.existingMedicalConditions.trim()) {
        nextErrors.existingMedicalConditions =
          'Enter existing medical conditions or None.'
      }

      if (!details.familyMedicalHistory.trim()) {
        nextErrors.familyMedicalHistory =
          'Enter family medical history or None.'
      }
    }

    if (planCategory === 'MOTOR') {
      if (!details.registrationNumber.trim()) {
        nextErrors.registrationNumber =
          'Enter the vehicle registration number.'
      }

      // RC verification is optional.
      // Customers can manually complete missing vehicle information.

      if (!details.vehicleMake.trim()) {
        nextErrors.vehicleMake = 'Enter the vehicle make.'
      }

      if (!details.vehicleModel.trim()) {
        nextErrors.vehicleModel = 'Enter the vehicle model.'
      }

      if (!details.manufacturingYear) {
        nextErrors.manufacturingYear =
          'Select the manufacturing year.'
      }

      if (
        details.manufacturingYear &&
        (
          Number(details.manufacturingYear) < 1900 ||
          Number(details.manufacturingYear) > new Date().getFullYear()
        )
      ) {
        nextErrors.manufacturingYear =
          'Enter a valid manufacturing year.'
      }

      if (!details.fuelType) {
        nextErrors.fuelType = 'Select the fuel type.'
      }

      if (!details.vehicleUsage) {
        nextErrors.vehicleUsage = 'Select vehicle usage.'
      }

      if (!details.previousInsurance) {
        nextErrors.previousInsurance =
          'Please indicate whether the vehicle had previous insurance.'
      }

      if (
        details.previousInsurance === 'Yes' &&
        !details.previousInsurer.trim()
      ) {
        nextErrors.previousInsurer =
          'Enter the previous insurance company.'
      }

      if (!details.previousClaims) {
        nextErrors.previousClaims =
          'Please indicate whether there were previous claims.'
      }

      if (
        details.previousClaims === 'Yes' &&
        !details.claimDetails.trim()
      ) {
        nextErrors.claimDetails =
          'Provide brief details of previous claims.'
      }
    }

    if (familyPlan) {
      if (familyMembers.length === 0) {
        nextErrors.familyMembers =
          'Add at least one family member for this plan.'
      }

      familyMembers.forEach((member, index) => {
        if (!member.name.trim()) {
          nextErrors[`family-${index}-name`] =
            'Enter the family member’s name.'
        }

        if (!member.relation) {
          nextErrors[`family-${index}-relation`] =
            'Select the relationship.'
        }

        if (!member.dateOfBirth) {
          nextErrors[`family-${index}-dateOfBirth`] =
            'Select date of birth.'
        }

        if (!member.gender) {
          nextErrors[`family-${index}-gender`] =
            'Select gender.'
        }

        if (!member.occupation) {
          nextErrors[`family-${index}-occupation`] =
            'Select occupation.'
        }
      })
    }

    setErrors(nextErrors)

    return Object.keys(nextErrors).length === 0
  }

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

    setErrors((current) => ({
      ...current,
      ...nextErrors,
    }))

    return Object.keys(nextErrors).length === 0
  }

  /* =========================================================
     RAZORPAY CHECKOUT
  ========================================================= */

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

  /* =========================================================
     CACHE SYNCHRONIZATION
  ========================================================= */

  async function refreshRelatedData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['my-purchases'] }),
      queryClient.invalidateQueries({ queryKey: ['my-policies'] }),
      queryClient.invalidateQueries({ queryKey: ['insurance-plans'] }),
      queryClient.invalidateQueries({ queryKey: ['my-claims'] }),
    ])
  }

  /* =========================================================
     PAYMENT
  ========================================================= */

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

    if (!isRenewal && !validateApplication()) {
      setStep(1)
      return
    }

    if (!validateNominee()) {
      setStep(isRenewal ? 1 : 2)
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
        amount: order.amount,
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
        amount: order.amount,
      })

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

            applicationDetails: {
              ...applicationDetails,
              planCode: policy.planCode || policy.code || '',
              planCategory,
            },

            familyMembers: familyPlan
              ? familyMembers.map((member) => ({
                  name: member.name.trim(),
                  relation: member.relation,
                  dateOfBirth: member.dateOfBirth,
                  gender: member.gender,
                  occupation: member.occupation,
                }))
              : [],

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
        console.error('InsureX cache refresh failed:', refreshError)
      }
    } catch (paymentError) {
      const cancelled = paymentError?.message === 'CHECKOUT_DISMISSED'

      if (cancelled) {
        setError(
          'Checkout was closed. If your bank shows a debit, check Payments before trying again.',
        )
      } else if (checkoutCompleted) {
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

  /* =========================================================
     SUCCESS
  ========================================================= */

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
                <dd>
                  {inr(
                    done.totalPremium ??
                    paymentReference?.amount ??
                    est?.total ??
                    0,
                  )}
                </dd>

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

  /* =========================================================
     QUERY STATUS
  ========================================================= */

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

  /* =========================================================
     APPLICATION FORM RENDERER
  ========================================================= */

  function renderApplicationField(field) {
    if (field.name === 'registrationNumber') {
      const currentRegistration = normalizeRegistration(
        applicationDetails.registrationNumber,
      )

      const isVerified = Boolean(
        currentRegistration &&
        rcVerification.verifiedRegistration === currentRegistration &&
        rcVerification.result
      )

      return (
        <div
          key={field.name}
          style={{
            gridColumn: '1 / -1',
            minWidth: 0,
            marginBottom: '15px',
          }}
        >
          <ApplicationField
            {...field}
            value={applicationDetails.registrationNumber}
            onChange={updateApplicationField}
            error={errors.registrationNumber}
            disabled={paying}
          />

          <div
            style={{
              marginTop: '5px',
              fontSize: '12px',
              color: '#65776c',
            }}
          >
            {rcVerification.loading ? (
              <span style={{ color: '#176b43' }}>
                Checking registration details automatically...
              </span>
            ) : isVerified ? (
              <span style={{ color: '#176b43', fontWeight: 600 }}>
                ✓ RC details retrieved successfully.
              </span>
            ) : rcVerification.error ? (
              <span style={{ color: '#b42318' }}>
                {rcVerification.error} Enter the vehicle details manually.
              </span>
            ) : (
              <span>
                Enter your registration number. Available vehicle details
                will be filled automatically.
              </span>
            )}
          </div>

          {isVerified && rcVerification.result && (
            <div
              style={{
                marginTop: '12px',
                padding: '12px 14px',
                border: '1px solid #c9e7d3',
                borderRadius: '9px',
                background: '#f4fbf6',
                color: '#176b43',
                fontSize: '13px',
              }}
            >
              <strong>RC information retrieved</strong>

              <p
                style={{
                  margin: '5px 0 0',
                  color: '#52675a',
                }}
              >
                Available information has been populated below.
                Please review it and complete any blank fields manually.
              </p>
            </div>
          )}
        </div>
      )
    }

    return (
      <ApplicationField
        key={field.name}
        {...field}
        value={applicationDetails[field.name]}
        onChange={updateApplicationField}
        error={errors[field.name]}
      />
    )
  }

  /* =========================================================
     APPLICATION FORM
  ========================================================= */

  function renderApplicationForm() {
    if (planCategory === 'HEALTH') {
      const fields = [
        {
          name: 'applicantName',
          label: 'Applicant full name',
          required: true,
        },
        {
          name: 'dateOfBirth',
          label: 'Date of birth',
          type: 'date',
          required: true,
        },
        {
          name: 'gender',
          label: 'Gender',
          type: 'select',
          options: GENDERS,
          required: true,
        },
        {
          name: 'occupation',
          label: 'Occupation',
          type: 'select',
          options: OCCUPATIONS,
          required: true,
        },
        {
          name: 'heightCm',
          label: 'Height (cm)',
          type: 'number',
          min: 30,
          max: 250,
          placeholder: 'Optional',
        },
        {
          name: 'weightKg',
          label: 'Weight (kg)',
          type: 'number',
          min: 2,
          max: 400,
          placeholder: 'Optional',
        },
        {
          name: 'hasPreExistingDisease',
          label: 'Do you have any pre-existing disease?',
          type: 'select',
          options: YES_NO,
          required: true,
        },
        {
          name: 'preExistingDiseases',
          label: 'Existing diseases and conditions',
          type: 'textarea',
          placeholder: 'Enter details, or leave blank if none',
          required:
            applicationDetails.hasPreExistingDisease === 'Yes',
        },
        {
          name: 'medicalHistory',
          label: 'Medical history',
          type: 'textarea',
          placeholder: 'Describe your medical history or enter None',
          required: true,
        },
        {
          name: 'takingMedication',
          label: 'Are you currently taking medication?',
          type: 'select',
          options: YES_NO,
          required: true,
        },
        {
          name: 'medicationDetails',
          label: 'Current medication details',
          type: 'textarea',
          placeholder: 'Medicine name and reason',
          required:
            applicationDetails.takingMedication === 'Yes',
        },
      ]

      return (
        <>
          <div style={sectionHeadingStyle}>
            <strong>Applicant information</strong>
            <span>Health insurance application</span>
          </div>

          <div style={applicationGridStyle}>
            {fields.map(renderApplicationField)}
          </div>

          {familyPlan && renderFamilyMembers()}
        </>
      )
    }

    if (planCategory === 'LIFE') {
      const fields = [
        {
          name: 'applicantName',
          label: 'Life assured full name',
          required: true,
        },
        {
          name: 'dateOfBirth',
          label: 'Date of birth',
          type: 'date',
          required: true,
        },
        {
          name: 'gender',
          label: 'Gender',
          type: 'select',
          options: GENDERS,
          required: true,
        },
        {
          name: 'occupation',
          label: 'Occupation',
          type: 'select',
          options: OCCUPATIONS,
          required: true,
        },
        {
          name: 'annualIncome',
          label: 'Annual income (₹)',
          type: 'number',
          min: 1,
          required: true,
        },
        {
          name: 'smokingStatus',
          label: 'Smoking status',
          type: 'select',
          options: [
            'Never smoked',
            'Former smoker',
            'Currently smoking',
          ],
          required: true,
        },
        {
          name: 'alcoholConsumption',
          label: 'Alcohol consumption',
          type: 'select',
          options: [
            'Never',
            'Occasionally',
            'Regularly',
          ],
          required: true,
        },
        {
          name: 'hazardousActivities',
          label: 'Do you participate in hazardous activities?',
          type: 'select',
          options: YES_NO,
          required: true,
        },
        {
          name: 'existingMedicalConditions',
          label: 'Existing medical conditions',
          type: 'textarea',
          placeholder: 'Enter details or None',
          required: true,
        },
        {
          name: 'familyMedicalHistory',
          label: 'Family medical history',
          type: 'textarea',
          placeholder: 'Enter relevant family medical history or None',
          required: true,
        },
      ]

      return (
        <>
          <div style={sectionHeadingStyle}>
            <strong>Life assured information</strong>
            <span>Life insurance application</span>
          </div>

          <div style={applicationGridStyle}>
            {fields.map(renderApplicationField)}
          </div>

          {familyPlan && renderFamilyMembers()}
        </>
      )
    }

    if (planCategory === 'MOTOR') {
      const fields = [
        {
          name: 'registrationNumber',
          label: 'Vehicle registration number',
          placeholder: 'e.g. TS09AB1234',
          required: true,
        },
        {
          name: 'ownerName',
          label: 'Registered owner name',
          placeholder: 'Auto-filled when available',
        },
        {
          name: 'vehicleMake',
          label: 'Vehicle make / manufacturer',
          placeholder: 'e.g. Maruti Suzuki',
          required: true,
        },
        {
          name: 'vehicleModel',
          label: 'Vehicle model',
          placeholder: 'Auto-filled when available, or enter manually',
          required: true,
        },
        {
          name: 'vehicleVariant',
          label: 'Vehicle variant',
          placeholder: 'Enter vehicle variant',
        },
        {
          name: 'manufacturingYear',
          label: 'Manufacturing year',
          type: 'number',
          min: 1900,
          max: new Date().getFullYear(),
          required: true,
        },
        {
          name: 'fuelType',
          label: 'Fuel type',
          type: 'select',
          options: FUEL_TYPES,
          required: true,
        },
        {
          name: 'vehicleState',
          label: 'Registration state',
          placeholder: 'Auto-filled when available',
        },
        {
          name: 'vehicleRto',
          label: 'RTO',
          placeholder: 'Auto-filled when available',
        },
        {
          name: 'insuranceValidity',
          label: 'Existing insurance validity',
          placeholder: 'Auto-filled when available',
        },
        {
          name: 'vehicleUsage',
          label: 'Vehicle usage',
          type: 'select',
          options: VEHICLE_USAGES,
          required: true,
        },
        {
          name: 'previousInsurance',
          label: 'Was the vehicle previously insured?',
          type: 'select',
          options: YES_NO,
          required: true,
        },
        {
          name: 'previousInsurer',
          label: 'Previous insurance company',
          placeholder: 'Enter insurer name',
          required:
            applicationDetails.previousInsurance === 'Yes',
        },
        {
          name: 'previousPolicyNumber',
          label: 'Previous policy number',
          placeholder: 'Optional',
        },
        {
          name: 'previousPolicyExpiryDate',
          label: 'Previous policy expiry date',
          type: 'date',
        },
        {
          name: 'previousClaims',
          label: 'Were any claims made previously?',
          type: 'select',
          options: YES_NO,
          required: true,
        },
        {
          name: 'claimDetails',
          label: 'Previous claim details',
          type: 'textarea',
          placeholder: 'Describe previous claims',
          required:
            applicationDetails.previousClaims === 'Yes',
        },
      ]

      return (
        <>
          <div style={sectionHeadingStyle}>
            <strong>Vehicle information</strong>
            <span>
              Enter your registration number to retrieve available
              vehicle information automatically. Complete any missing
              details manually.
            </span>
          </div>

          <div style={applicationGridStyle}>
            {fields.map(renderApplicationField)}
          </div>
        </>
      )
    }

    return (
      <div className="alert warn">
        Unable to identify the selected plan category. Please contact support.
      </div>
    )
  }

  /* =========================================================
     FAMILY MEMBERS
  ========================================================= */

  function renderFamilyMembers() {
    return (
      <div style={{ marginTop: '22px' }}>
        <div
          style={{
            ...sectionHeadingStyle,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <strong>Family members</strong>
            <span>Add the members who will be covered by this plan.</span>
          </div>

          <Button
            type="button"
            variant="dark"
            onClick={addFamilyMember}
            disabled={paying}
          >
            + Add member
          </Button>
        </div>

        {errors.familyMembers && (
          <div className="alert error" role="alert">
            {errors.familyMembers}
          </div>
        )}

        {familyMembers.map((member, index) => (
          <div
            key={index}
            style={{
              border: '1px solid #dce8e1',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '14px',
              background: '#fbfdfb',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                marginBottom: '14px',
              }}
            >
              <strong style={{ color: '#176b43', fontSize: '14px' }}>
                Family member {index + 1}
              </strong>

              <button
                type="button"
                onClick={() => removeFamilyMember(index)}
                disabled={paying}
                style={{
                  border: '1px solid #e7c8c8',
                  background: '#fff',
                  color: '#b33b3b',
                  borderRadius: '7px',
                  padding: '6px 10px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                Remove
              </button>
            </div>

            <div style={applicationGridStyle}>
              {[
                {
                  name: 'name',
                  label: 'Full name',
                  type: 'text',
                },
                {
                  name: 'relation',
                  label: 'Relationship',
                  type: 'select',
                  options: RELATIONS,
                },
                {
                  name: 'dateOfBirth',
                  label: 'Date of birth',
                  type: 'date',
                },
                {
                  name: 'gender',
                  label: 'Gender',
                  type: 'select',
                  options: GENDERS,
                },
                {
                  name: 'occupation',
                  label: 'Occupation',
                  type: 'select',
                  options: OCCUPATIONS,
                },
              ].map((field) => (
                <ApplicationField
                  key={field.name}
                  {...field}
                  value={member[field.name]}
                  onChange={(name, value) =>
                    updateFamilyMember(index, name, value)
                  }
                  error={errors[`family-${index}-${field.name}`]}
                  required
                />
              ))}
            </div>
          </div>
        ))}

        {familyMembers.length === 0 && (
          <div
            style={{
              border: '1px dashed #b9cec1',
              borderRadius: '10px',
              padding: '18px',
              color: '#607468',
              textAlign: 'center',
              fontSize: '13px',
            }}
          >
            No family members added yet. Select Add member to continue.
          </div>
        )}
      </div>
    )
  }

  /* =========================================================
     APPLICATION REVIEW
  ========================================================= */

  function renderApplicationReview() {
    const excludedKeys = new Set([
      'preExistingDiseases',
      'medicationDetails',
      'medicalHistory',
      'existingMedicalConditions',
      'familyMedicalHistory',
      'claimDetails',
    ])

    const entries = Object.entries(applicationDetails)
      .filter(([key, value]) => (
        value !== '' &&
        value !== null &&
        value !== undefined &&
        !excludedKeys.has(key)
      ))

    return (
      <div style={{ marginTop: '16px' }}>
        <h4 style={{ color: '#176b43', marginBottom: '10px' }}>
          Application information
        </h4>

        <dl className="kv">
          {entries.map(([key, value]) => (
            <div key={key} style={{ display: 'contents' }}>
              <dt>{displayLabel(key)}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>

        {[
          ['medicalHistory', 'Medical history'],
          ['preExistingDiseases', 'Pre-existing diseases'],
          ['medicationDetails', 'Medication details'],
          ['existingMedicalConditions', 'Existing medical conditions'],
          ['familyMedicalHistory', 'Family medical history'],
          ['claimDetails', 'Previous claim details'],
        ].map(([key, label]) => (
          applicationDetails[key] ? (
            <div key={key} style={{ marginTop: '10px' }}>
              <strong style={{ fontSize: '13px', color: '#34483e' }}>
                {label}
              </strong>
              <p style={{ fontSize: '13px', color: '#53665c', marginTop: '4px' }}>
                {applicationDetails[key]}
              </p>
            </div>
          ) : null
        ))}

        {familyPlan && familyMembers.length > 0 && (
          <div style={{ marginTop: '18px' }}>
            <h4 style={{ color: '#176b43' }}>Covered family members</h4>

            {familyMembers.map((member, index) => (
              <div
                key={index}
                style={{
                  padding: '12px',
                  border: '1px solid #e0e9e3',
                  borderRadius: '9px',
                  marginTop: '8px',
                  fontSize: '13px',
                }}
              >
                <strong>{member.name}</strong>
                <div style={{ color: '#5a6c62', marginTop: '4px' }}>
                  {member.relation} · {member.gender} · {member.dateOfBirth}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  /* =========================================================
     NAVIGATION VALIDATION
  ========================================================= */

  function continueStep() {
    setError('')

    if (step === 0) {
      if (!coverageIsValid || !durationIsValid) {
        setError('Choose valid coverage and duration.')
        return
      }

      setStep(1)
      return
    }

    if (!isRenewal && step === 1) {
      if (!validateApplication()) {
        setError('Please complete the required application details.')
        return
      }

      setStep(2)
      return
    }

    if (
      (isRenewal && step === 1) ||
      (!isRenewal && step === 2)
    ) {
      if (!validateNominee()) return

      setStep(isRenewal ? 2 : 3)
    }
  }

  /* =========================================================
     RENDER
  ========================================================= */

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
              : 'Choose your cover, complete your application and pay securely.'}
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
                        Order ID:{' '}
                        <strong>{paymentReference.orderId || '—'}</strong>
                      </div>

                      {paymentReference.paymentId && (
                        <div>
                          Payment ID:{' '}
                          <strong>{paymentReference.paymentId}</strong>
                        </div>
                      )}

                      {Number.isFinite(paymentReference.amount) && (
                        <div>
                          Order amount:{' '}
                          <strong>{inr(paymentReference.amount)}</strong>
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
                {applicationStepLabel.map((label, index) => (
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
                        <dd>
                          {effectiveYears}{' '}
                          {effectiveYears === 1 ? 'year' : 'years'}
                        </dd>

                        {!isRenewal && (
                          <>
                            <dt>Plan code</dt>
                            <dd>{policy.planCode || '—'}</dd>

                            <dt>Base premium</dt>
                            <dd>
                              {inr(policy.basePremium)} per{' '}
                              {inr(policy.baseCoverage)} of cover, per year
                            </dd>

                            <dt>
                              InsureX discount ({est.discountRate}%)
                            </dt>
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

                  {/* STEP 2 — APPLICATION DETAILS */}

                  {!isRenewal && step === 1 && (
                    <Panel title="Insurance application details">
                      <p
                        style={{
                          color: '#617267',
                          fontSize: '13px',
                          marginTop: 0,
                          marginBottom: '20px',
                        }}
                      >
                        Complete the information required for your selected
                        {` ${planCategory.toLowerCase()} `}insurance plan.
                        Fields marked with * are required.
                      </p>

                      {errors.application && (
                        <div className="alert error">
                          {errors.application}
                        </div>
                      )}

                      {renderApplicationForm()}
                    </Panel>
                  )}

                  {/* NOMINEE */}

                  {(
                    (isRenewal && step === 1) ||
                    (!isRenewal && step === 2)
                  ) && (
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
                              setErrors({
                                ...errors,
                                name: '',
                              })
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
                            setErrors({
                              ...errors,
                              relation: '',
                            })
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

                            setNominee({
                              ...nominee,
                              contact,
                            })

                            setErrors({
                              ...errors,
                              contact: '',
                            })
                          }}
                          error={errors.contact}
                          disabled={isRenewal}
                        />
                      </div>
                    </Panel>
                  )}

                  {/* REVIEW */}

                  {(
                    (isRenewal && step === 2) ||
                    (!isRenewal && step === 3)
                  ) && (
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
                        <dd>
                          {effectiveYears}{' '}
                          {effectiveYears === 1 ? 'year' : 'years'}
                        </dd>

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

                            <dt>
                              InsureX discount ({est.discountRate}%)
                            </dt>
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

                      {!isRenewal && renderApplicationReview()}

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

                    {step < (isRenewal ? 2 : 3) ? (
                      <Button
                        variant="dark"
                        disabled={paying || paymentUncertain}
                        onClick={continueStep}
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

/* =========================================================
   INLINE LAYOUT STYLES
========================================================= */

const applicationGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
  columnGap: '16px',
  rowGap: '2px',
}

const sectionHeadingStyle = {
  marginBottom: '16px',
  color: '#176b43',
  fontSize: '15px',
  fontWeight: 700,
  display: 'flex',
  flexDirection: 'column',
  gap: '5px',
}
