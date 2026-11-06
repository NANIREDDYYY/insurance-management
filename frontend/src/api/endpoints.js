
/* =========================================================
   INSUREX — CENTRAL API ENDPOINTS
   File: src/api/endpoints.js
========================================================= */

import { api } from './client'

/* =========================================================
   COMMON HELPERS
========================================================= */

const d = (promise) =>
  promise.then((response) => response.data)

const id = (value) =>
  encodeURIComponent(String(value))

function positiveId(value, label = 'ID') {
  const number = Number(value)

  if (
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    throw new Error(`A valid ${label} is required.`)
  }

  return number
}

function requiredText(value, label) {
  const text = String(value ?? '').trim()

  if (!text) {
    throw new Error(`${label} is required.`)
  }

  return text
}

function paymentConfirmation(body) {
  if (!body || typeof body !== 'object') {
    throw new Error(
      'Payment confirmation details are required.'
    )
  }

  return {
    razorpayOrderId: requiredText(
      body.razorpayOrderId,
      'Razorpay order ID'
    ),
    razorpayPaymentId: requiredText(
      body.razorpayPaymentId,
      'Razorpay payment ID'
    ),
    razorpaySignature: requiredText(
      body.razorpaySignature,
      'Razorpay signature'
    ),
  }
}

/* =========================================================
   AUTHENTICATION
========================================================= */

export const auth = {
  login: (body) =>
    d(api.post('/api/auth/login', body)),

  sendOtp: (identifier) =>
    d(api.post('/api/auth/send-otp', { identifier })),

  verifyOtp: (body) =>
    d(api.post('/api/auth/verify-otp', body)),

  forgotPassword: (identifier) =>
    d(api.post('/api/auth/forgot-password', { identifier })),

  resetPassword: (body) =>
    d(api.post('/api/auth/reset-password', body)),

  session: () =>
    d(api.get('/api/session')),
}

/* =========================================================
   USERS
========================================================= */

export const users = {
  register: (body) =>
    d(api.post('/user/save', body)),

  me: () =>
    d(api.get('/user/me')),

  updateMe: (body) =>
    d(api.put('/user/me', body)),

  changePassword: (body) =>
    d(api.put('/user/me/password', body)),

  getAll: () =>
    d(api.get('/user/getAll')),

  get: (userId) =>
    d(api.get(`/user/get/${id(userId)}`)),

  update: (userId, body) =>
    d(api.put(`/user/update/${id(userId)}`, body)),

  activate: (userId) =>
    d(api.put(`/user/activate/${id(userId)}`)),

  deactivate: (userId) =>
    d(api.put(`/user/deactivate/${id(userId)}`)),

  remove: (userId) =>
    d(api.delete(`/user/delete/${id(userId)}`)),
}

/* =========================================================
   INSURANCE PLANS
========================================================= */

export const plans = {
  available: () =>
    d(api.get('/api/plans/available')),

  get: (planId) =>
    d(api.get(`/api/plans/${id(planId)}`)),
}

/* =========================================================
   POLICIES
========================================================= */

export const policies = {
  available: () =>
    d(api.get('/policy/available')),

  mine: () =>
    d(api.get('/policy/my-policies')),

  getAll: () =>
    d(api.get('/policy/getAll')),

  get: (policyNumber) =>
    d(api.get(`/policy/get/${id(policyNumber)}`)),

  save: (body) =>
    d(api.post('/policy/save', body)),

  update: (policyNumber, body) =>
    d(
      api.put(
        `/policy/update/${id(policyNumber)}`,
        body
      )
    ),

  remove: (policyNumber) =>
    d(api.delete(`/policy/delete/${id(policyNumber)}`)),

  activate: (policyNumber) =>
    d(api.put(`/policy/activate/${id(policyNumber)}`)),

  deactivate: (policyNumber) =>
    d(api.put(`/policy/deactivate/${id(policyNumber)}`)),
}

/* =========================================================
   VEHICLE RC VERIFICATION — API EXPRESS
========================================================= */

export const vehicleVerification = {
  verify: (registrationNumber) => {
    const normalizedNumber = String(
      registrationNumber ?? ''
    )
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '')

    if (
      !/^[A-Z0-9]{6,15}$/.test(normalizedNumber)
    ) {
      return Promise.reject(
        new Error(
          'Enter a valid vehicle registration number.'
        )
      )
    }

    return d(
      api.post('/api/vehicles/verify', {
        registrationNumber: normalizedNumber,
      })
    )
  },
}

/* =========================================================
   POLICY PURCHASES & REFUNDS
========================================================= */

export const purchases = {
  purchase: (body) =>
    d(api.post('/policy/purchase', body)),

  mine: () =>
    d(api.get('/policy/my-purchases')),

  getAll: () =>
    d(api.get('/policy/purchases')),

  // Matches PolicyPurchaseController:
  // POST /policy/purchases/{purchaseId}/refund
  //
  // Never automatically retry a financial mutation.

  refund: (purchaseId, body) => {
    try {
      const parsedPurchaseId = positiveId(
        purchaseId,
        'purchase ID'
      )

      const refundReason = requiredText(
        body?.refundReason,
        'Refund reason'
      )

      if (refundReason.length > 500) {
        throw new Error(
          'Refund reason must not exceed 500 characters.'
        )
      }

      return d(
        api.post(
          `/policy/purchases/${id(parsedPurchaseId)}/refund`,
          {
            purchaseId: parsedPurchaseId,
            refundReason,
          }
        )
      )
    } catch (error) {
      return Promise.reject(error)
    }
  },
}

/* =========================================================
   PAYMENTS — RAZORPAY
========================================================= */

export const payment = {
  createOrder: (body) => {
    try {
      if (!body || typeof body !== 'object') {
        throw new Error(
          'Payment order details are required.'
        )
      }

      const planId = positiveId(
        body.planId,
        'plan ID'
      )

      const coverageAmount = Number(
        body.coverageAmount
      )

      const durationYears = Number(
        body.durationYears
      )

      if (
        !Number.isFinite(coverageAmount) ||
        coverageAmount <= 0
      ) {
        throw new Error(
          'A valid coverage amount is required.'
        )
      }

      if (
        !Number.isInteger(durationYears) ||
        durationYears < 1 ||
        durationYears > 5
      ) {
        throw new Error(
          'Duration must be between 1 and 5 years.'
        )
      }

      return d(
        api.post('/payment/create-order', {
          planId,
          coverageAmount,
          durationYears,
          currency: 'INR',
        })
      )
    } catch (error) {
      return Promise.reject(error)
    }
  },

  verify: (body) => {
    try {
      return d(
        api.post(
          '/payment/verify',
          paymentConfirmation(body)
        )
      )
    } catch (error) {
      return Promise.reject(error)
    }
  },
}

/* =========================================================
   POLICY RENEWALS — RAZORPAY
========================================================= */

export const renewals = {
  createOrder: (originalPolicyNumber) => {
    try {
      const policyNumber = positiveId(
        originalPolicyNumber,
        'original policy number'
      )

      return d(
        api.post(
          `/api/policy-renewals/${id(policyNumber)}/order`
        )
      )
    } catch (error) {
      return Promise.reject(error)
    }
  },

  confirm: (originalPolicyNumber, body) => {
    try {
      const policyNumber = positiveId(
        originalPolicyNumber,
        'original policy number'
      )

      return d(
        api.post(
          `/api/policy-renewals/${id(policyNumber)}/confirm`,
          paymentConfirmation(body)
        )
      )
    } catch (error) {
      return Promise.reject(error)
    }
  },
}

/* =========================================================
   POLICY HOLDERS
========================================================= */

export const policyHolders = {
  getAll: () =>
    d(api.get('/policyholder/getAll')),

  get: (policyHolderId) =>
    d(api.get(`/policyholder/get/${id(policyHolderId)}`)),

  save: (body) =>
    d(api.post('/policyholder/save', body)),

  update: (policyHolderId, body) =>
    d(
      api.put(
        `/policyholder/update/${id(policyHolderId)}`,
        body
      )
    ),

  remove: (policyHolderId) =>
    d(
      api.delete(
        `/policyholder/delete/${id(policyHolderId)}`
      )
    ),
}

/* =========================================================
   CLAIMS
========================================================= */

export const claims = {
  save: (body) =>
    d(api.post('/claims/save', body)),

  mine: () =>
    d(api.get('/claims/my-claims')),

  getAll: () =>
    d(api.get('/claims/getAll')),

  get: (claimNumber) =>
    d(api.get(`/claims/get/${id(claimNumber)}`)),

  update: (claimNumber, body) =>
    d(
      api.put(
        `/claims/update/${id(claimNumber)}`,
        body
      )
    ),

  approve: (claimNumber, body) =>
    d(
      api.put(
        `/claims/approve/${id(claimNumber)}`,
        body
      )
    ),

  reject: (claimNumber, body) =>
    d(
      api.put(
        `/claims/reject/${id(claimNumber)}`,
        body
      )
    ),

  remove: (claimNumber) =>
    d(
      api.delete(
        `/claims/delete/${id(claimNumber)}`
      )
    ),
}

/* =========================================================
   SETTLEMENTS — MANUAL BANK TRANSFER
========================================================= */

export const settlements = {
  getAll: () =>
    d(api.get('/settlement/getAll')),

  get: (settlementNumber) =>
    d(
      api.get(
        `/settlement/get/${id(settlementNumber)}`
      )
    ),

  byClaim: (claimNumber) =>
    d(
      api.get(
        `/settlement/claim/${id(claimNumber)}`
      )
    ),

  save: (body) =>
    d(api.post('/settlement/save', body)),

  update: (settlementNumber, body) =>
    d(
      api.put(
        `/settlement/update/${id(settlementNumber)}`,
        body
      )
    ),

  transfer: (settlementNumber, body) => {
    try {
      const settlementId = positiveId(
        settlementNumber,
        'settlement number'
      )

      const transactionReference = requiredText(
        body?.transactionReference,
        'Bank transaction reference / UTR'
      )

      const transferDate = requiredText(
        body?.transferDate,
        'Transfer date'
      )

      if (transactionReference.length > 150) {
        throw new Error(
          'Bank transaction reference must not exceed 150 characters.'
        )
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(transferDate)) {
        throw new Error(
          'Transfer date must use YYYY-MM-DD format.'
        )
      }

      const parsedDate = new Date(
        `${transferDate}T00:00:00Z`
      )

      if (
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== transferDate
      ) {
        throw new Error(
          'Enter a valid transfer date.'
        )
      }

      return d(
        api.put(
          `/settlement/transfer/${id(settlementId)}`,
          {
            transactionReference,
            transferDate,
          }
        )
      )
    } catch (error) {
      return Promise.reject(error)
    }
  },

  confirm: (settlementNumber, body) => {
    try {
      const settlementId = positiveId(
        settlementNumber,
        'settlement number'
      )

      if (body?.paymentVerified !== true) {
        throw new Error(
          'Bank payment verification is required before confirmation.'
        )
      }

      const confirmationRemarks = requiredText(
        body?.confirmationRemarks,
        'Payment confirmation remarks'
      )

      if (confirmationRemarks.length > 1000) {
        throw new Error(
          'Confirmation remarks must not exceed 1000 characters.'
        )
      }

      return d(
        api.put(
          `/settlement/confirm/${id(settlementId)}`,
          {
            paymentVerified: true,
            confirmationRemarks,
          }
        )
      )
    } catch (error) {
      return Promise.reject(error)
    }
  },

  fail: (settlementNumber, reason) => {
    try {
      const settlementId = positiveId(
        settlementNumber,
        'settlement number'
      )

      const failureReason = requiredText(
        reason,
        'Transfer failure reason'
      )

      if (failureReason.length > 1000) {
        throw new Error(
          'Failure reason must not exceed 1000 characters.'
        )
      }

      return d(
        api.put(
          `/settlement/fail/${id(settlementId)}`,
          {
            reason: failureReason,
          }
        )
      )
    } catch (error) {
      return Promise.reject(error)
    }
  },

  // Preserved for compatibility.
  process: (settlementNumber) =>
    d(
      api.put(
        `/settlement/process/${id(settlementNumber)}`
      )
    ),

  reject: (settlementNumber, rejectionReason) =>
    d(
      api.put(
        `/settlement/reject/${id(settlementNumber)}`,
        {
          rejectionReason,
        }
      )
    ),

  remove: (settlementNumber) =>
    d(
      api.delete(
        `/settlement/delete/${id(settlementNumber)}`
      )
    ),
}

/* =========================================================
   REVIEWS
========================================================= */

export const reviews = {
  save: (body) =>
    d(api.post('/reviewer/save', body)),

  mine: () =>
    d(api.get('/reviewer/my-reviews')),

  getAll: () =>
    d(api.get('/reviewer/getAll')),

  get: (reviewId) =>
    d(api.get(`/reviewer/get/${id(reviewId)}`)),

  update: (reviewId, body) =>
    d(
      api.put(
        `/reviewer/update/${id(reviewId)}`,
        body
      )
    ),

  reply: (reviewId, body) =>
    d(
      api.put(
        `/reviewer/reply/${id(reviewId)}`,
        body
      )
    ),

  remove: (reviewId) =>
    d(
      api.delete(
        `/reviewer/delete/${id(reviewId)}`
      )
    ),
}

/* =========================================================
   CUSTOMER NOTIFICATIONS
========================================================= */

export const notifications = {
  mine: () =>
    d(api.get('/api/notifications/my')),

  unread: () =>
    d(
      api.get('/api/notifications/unread-count')
    ),

  read: (notificationId) =>
    d(
      api.put(
        `/api/notifications/read/${id(notificationId)}`
      )
    ),

  readAll: () =>
    d(api.put('/api/notifications/read-all')),

  remove: (notificationId) =>
    d(
      api.delete(
        `/api/notifications/${id(notificationId)}`
      )
    ),
}

/* =========================================================
   ADMIN BROADCAST
========================================================= */

export const broadcast = {
  send: (body) =>
    d(
      api.post(
        '/api/admin/notifications',
        body
      )
    ),

  customers: () =>
    d(
      api.get(
        '/api/admin/notifications/customers'
      )
    ),

  list: () =>
    d(
      api.get('/api/admin/notifications')
    ),

  remove: (notificationId) =>
    d(
      api.delete(
        `/api/admin/notifications/${id(notificationId)}`
      )
    ),
}
