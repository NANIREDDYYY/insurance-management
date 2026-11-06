
package com.htc.insurance.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import org.json.JSONObject;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

import lombok.RequiredArgsConstructor;

import com.htc.insurance.dao.PolicyDao;
import com.htc.insurance.dao.PolicyPurchaseDao;

import com.htc.insurance.dto.PaymentOrderRequest;
import com.htc.insurance.dto.PaymentOrderResponse;
import com.htc.insurance.dto.PaymentVerificationRequest;

import com.htc.insurance.entity.InsurancePlan;
import com.htc.insurance.entity.Policy;
import com.htc.insurance.entity.PolicyLifecycleStatus;
import com.htc.insurance.entity.PolicyPurchase;

import com.htc.insurance.repository.InsurancePlanRepository;
import com.htc.insurance.repository.PolicyPurchaseRepository;

import com.razorpay.Order;
import com.razorpay.Payment;
import com.razorpay.RazorpayClient;

@Service
@RequiredArgsConstructor
public class PaymentService {

    // =========================================================
    // PAYMENT CONFIGURATION
    // =========================================================

    private static final BigDecimal MAX_COVERAGE =
            new BigDecimal("10000000");

    private static final int MIN_DURATION_YEARS = 1;
    private static final int MAX_DURATION_YEARS = 5;

    private static final BigDecimal LONG_TERM_DISCOUNT =
            new BigDecimal("0.05");

    // GST for ordinary private motor insurance.
    private static final BigDecimal MOTOR_GST_RATE =
            new BigDecimal("0.18");

    private static final BigDecimal ZERO =
            BigDecimal.ZERO.setScale(
                    2,
                    RoundingMode.HALF_UP);

    // =========================================================
    // DEPENDENCIES
    // =========================================================

    private final InsurancePlanRepository insurancePlanRepository;

    private final PaymentAttemptService paymentAttemptService;

    private final PolicyDao policyDao;

    private final PolicyPurchaseDao policyPurchaseDao;

    private final PolicyPurchaseRepository policyPurchaseRepository;

    @Value("${razorpay.key.id}")
    private String razorpayKeyId;

    @Value("${razorpay.key.secret}")
    private String razorpayKeySecret;

    @Value("${razorpay.currency:INR}")
    private String currency;

    // =========================================================
    // CREATE NORMAL PURCHASE ORDER
    // =========================================================

    public PaymentOrderResponse createOrder(
            PaymentOrderRequest request,
            String authenticatedUsername) throws Exception {

        if (request == null) {
            throw new IllegalArgumentException(
                    "Payment request is required.");
        }

        requireUsername(authenticatedUsername);

        if (request.getPlanId() == null
                || request.getPlanId() <= 0) {
            throw new IllegalArgumentException(
                    "A valid insurance plan is required.");
        }

        // Validate duration.
        if (request.getDurationYears() == null
                || request.getDurationYears() < MIN_DURATION_YEARS
                || request.getDurationYears() > MAX_DURATION_YEARS) {
            throw new IllegalArgumentException(
                    "Policy duration must be between 1 and 5 years.");
        }

        // Validate currency.
        if (request.getCurrency() != null
                && !request.getCurrency().isBlank()
                && !currency.equalsIgnoreCase(
                        request.getCurrency().trim())) {
            throw new IllegalArgumentException(
                    "Unsupported payment currency. Only "
                    + currency + " is supported.");
        }

        // Load insurance plan.
        InsurancePlan plan = insurancePlanRepository
                .findById(request.getPlanId())
                .orElseThrow(() ->
                        new IllegalArgumentException(
                                "The selected insurance plan was not found."));

        if (!Boolean.TRUE.equals(plan.getIsActive())) {
            throw new IllegalArgumentException(
                    "The selected insurance plan is not available.");
        }

        BigDecimal basePremium = plan.getBasePremium();
        BigDecimal baseCoverage = plan.getBaseCoverage();

        if (basePremium == null
                || basePremium.compareTo(BigDecimal.ZERO) <= 0
                || baseCoverage == null
                || baseCoverage.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalStateException(
                    "The selected insurance plan has invalid pricing.");
        }

        // Validate coverage against the selected plan.
        BigDecimal minimumCoverage = baseCoverage;
        BigDecimal maximumCoverage = MAX_COVERAGE.max(baseCoverage);

        if (request.getCoverageAmount() == null
                || request.getCoverageAmount().compareTo(
                        minimumCoverage) < 0
                || request.getCoverageAmount().compareTo(
                        maximumCoverage) > 0) {
            throw new IllegalArgumentException(
                    "Coverage for " + plan.getPlanName()
                    + " must be between ₹"
                    + minimumCoverage.stripTrailingZeros().toPlainString()
                    + " and ₹"
                    + maximumCoverage.stripTrailingZeros().toPlainString()
                    + ".");
        }

        // Calculate base premium.
        BigDecimal coverageAmount =
                request.getCoverageAmount().setScale(
                        2,
                        RoundingMode.HALF_UP);

        BigDecimal coverageFactor =
                coverageAmount.divide(
                        baseCoverage,
                        10,
                        RoundingMode.HALF_UP);

        BigDecimal calculatedBasePremium =
                basePremium
                        .multiply(coverageFactor)
                        .multiply(BigDecimal.valueOf(
                                request.getDurationYears()))
                        .setScale(
                                2,
                                RoundingMode.HALF_UP);

        // Apply long-term discount.
        BigDecimal discount = ZERO;

        if (request.getDurationYears() >= 2) {
            discount = calculatedBasePremium
                    .multiply(LONG_TERM_DISCOUNT)
                    .setScale(
                            2,
                            RoundingMode.HALF_UP);
        }

        // GST is calculated on the discounted premium.
        BigDecimal taxableAmount =
                calculatedBasePremium
                        .subtract(discount)
                        .setScale(
                                2,
                                RoundingMode.HALF_UP);

        BigDecimal gstRate = getGstRate(plan);

        BigDecimal gstAmount =
                taxableAmount
                        .multiply(gstRate)
                        .setScale(
                                2,
                                RoundingMode.HALF_UP);

        BigDecimal totalPremium =
                taxableAmount
                        .add(gstAmount)
                        .setScale(
                                2,
                                RoundingMode.HALF_UP);

        if (totalPremium.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException(
                    "Calculated premium must be greater than zero.");
        }

        // Create payment attempt.
        String attemptReference =
                paymentAttemptService.createAttempt(
                        authenticatedUsername,
                        request.getPlanId(),
                        coverageAmount,
                        request.getDurationYears(),
                        totalPremium,
                        currency);

        String receipt = request.getReceipt();

        if (receipt == null || receipt.isBlank()) {
            receipt = attemptReference;
        }

        // Create Razorpay order.
        return createAndRecordOrder(
                attemptReference,
                totalPremium,
                receipt);
    }

    // =========================================================
    // GST CLASSIFICATION
    // =========================================================

    /**
     * GST classification based on the existing plan codes.
     *
     * HLT - qualifying individual/family health policies: 0%
     * LIF - qualifying individual/family life policies: 0%
     * MTR - ordinary private motor insurance: 18%
     *
     * Unknown plan codes fail closed instead of silently
     * applying an incorrect tax rate.
     */
    private BigDecimal getGstRate(InsurancePlan plan) {

        if (plan == null
                || plan.getPlanCode() == null
                || plan.getPlanCode().isBlank()) {
            throw new IllegalStateException(
                    "GST classification is unavailable for this plan.");
        }

        String planCode = plan.getPlanCode()
                .trim()
                .toUpperCase(java.util.Locale.ROOT);

        if (planCode.startsWith("HLT-")
                || planCode.startsWith("LIF-")) {
            return ZERO;
        }

        if (planCode.startsWith("MTR-")) {
            return MOTOR_GST_RATE;
        }

        throw new IllegalStateException(
                "GST classification is not configured for plan: "
                + planCode);
    }

    // =========================================================
    // CREATE RENEWAL ORDER
    // =========================================================

    /**
     * Renewal uses the original paid purchase amount.
     * Eligibility must be enforced by PolicyRenewalService.
     */
    public PaymentOrderResponse createRenewalOrder(
            Long originalPolicyNumber,
            Long originalPlanId,
            String authenticatedUsername) throws Exception {

        requireUsername(authenticatedUsername);

        if (originalPolicyNumber == null
                || originalPolicyNumber <= 0) {
            throw new IllegalArgumentException(
                    "A valid original policy number is required.");
        }

        if (originalPlanId == null
                || originalPlanId <= 0) {
            throw new IllegalArgumentException(
                    "A valid original plan ID is required.");
        }

        // Load original policy.
        Policy policy =
                policyDao.getPolicyById(originalPolicyNumber);

        if (policy == null
                || policy.getPolicyHolder() == null
                || policy.getPolicyHolder().getUser() == null) {
            throw new IllegalArgumentException(
                    "Original policy was not found.");
        }

        // Verify ownership.
        String owner = policy.getPolicyHolder()
                .getUser()
                .getUsername();

        if (!authenticatedUsername.equals(owner)) {
            throw new AccessDeniedException(
                    "This policy belongs to another customer.");
        }

        // Verify lifecycle.
        PolicyLifecycleStatus lifecycle =
                policy.getLifecycleStatus();

        if (lifecycle == PolicyLifecycleStatus.REFUND_PENDING
                || lifecycle == PolicyLifecycleStatus.REFUNDED) {
            throw new IllegalStateException(
                    "Policies with pending or completed refunds "
                    + "cannot be renewed.");
        }

        if (lifecycle == PolicyLifecycleStatus.ADMIN_DISABLED) {
            throw new IllegalStateException(
                    "Administratively disabled policies cannot be renewed.");
        }

        // Load original purchase.
        PolicyPurchase originalPurchase =
                policyPurchaseDao.getPurchaseByPolicyNumber(
                        originalPolicyNumber);

        if (originalPurchase == null) {
            throw new IllegalStateException(
                    "Original policy purchase was not found.");
        }

        // Verify original plan.
        if (originalPurchase.getPlanId() != null
                && !originalPurchase.getPlanId().equals(originalPlanId)) {
            throw new IllegalStateException(
                    "Renewal plan does not match the original purchase.");
        }

        // Verify original payment.
        if (!"PAID".equalsIgnoreCase(
                originalPurchase.getPaymentStatus())) {
            throw new IllegalStateException(
                    "Only paid policies can be renewed.");
        }

        if (!"NOT_REFUNDED".equalsIgnoreCase(
                originalPurchase.getRefundStatus())) {
            throw new IllegalStateException(
                    "Refunded or refund-processing policies "
                    + "cannot be renewed.");
        }

        // Prevent duplicate renewal.
        if (policyPurchaseRepository
                .existsByRenewedFromPurchasePurchaseId(
                        originalPurchase.getPurchaseId())) {
            throw new IllegalStateException(
                    "This policy has already been renewed.");
        }

        // Validate original duration.
        if (policy.getDurationYears() == null
                || policy.getDurationYears() < MIN_DURATION_YEARS
                || policy.getDurationYears() > MAX_DURATION_YEARS) {
            throw new IllegalStateException(
                    "Original policy duration is invalid.");
        }

        // Validate original premium.
        BigDecimal originalPremium =
                originalPurchase.getTotalPremium();

        if (originalPremium == null
                || originalPremium.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalStateException(
                    "Original paid premium is invalid.");
        }

        // Validate original coverage.
        BigDecimal coverage =
                originalPurchase.getCoverageAmount();

        if (coverage == null
                || coverage.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalStateException(
                    "Original policy coverage is invalid.");
        }

        // Create renewal payment attempt.
        String attemptReference =
                paymentAttemptService.createRenewalAttempt(
                        authenticatedUsername,
                        originalPolicyNumber,
                        originalPlanId,
                        coverage,
                        policy.getDurationYears(),
                        originalPremium,
                        currency);

        // Create renewal Razorpay order.
        // Do not apply GST again to an already paid amount.
        return createAndRecordOrder(
                attemptReference,
                originalPremium,
                attemptReference);
    }

    // =========================================================
    // SHARED RAZORPAY ORDER CREATION
    // =========================================================

    private PaymentOrderResponse createAndRecordOrder(
            String attemptReference,
            BigDecimal totalPremium,
            String receipt) throws Exception {

        PaymentOrderResponse response;

        try {
            response = createRazorpayOrder(
                    totalPremium,
                    receipt);

        } catch (Exception exception) {

            markReconciliationSafely(
                    attemptReference,
                    "Razorpay order creation outcome "
                    + "could not be confirmed.");

            throw exception;
        }

        try {
            paymentAttemptService.markOrderCreated(
                    attemptReference,
                    response.getOrderId());

        } catch (Exception persistenceException) {

            markReconciliationSafely(
                    attemptReference,
                    "Razorpay order was created, but "
                    + "its order ID could not be saved.");

            throw new IllegalStateException(
                    "The payment order could not be fully recorded. "
                    + "Do not start another payment. "
                    + "Contact support for reconciliation.",
                    persistenceException);
        }

        return response;
    }

    // =========================================================
    // MARK RECONCILIATION SAFELY
    // =========================================================

    private void markReconciliationSafely(
            String attemptReference,
            String reason) {

        try {
            paymentAttemptService.markReconciliationRequired(
                    attemptReference,
                    reason);

        } catch (Exception exception) {
            // Preserve the original payment exception.
        }
    }

    // =========================================================
    // CREATE RAZORPAY ORDER
    // =========================================================

    private PaymentOrderResponse createRazorpayOrder(
            BigDecimal amount,
            String requestedReceipt) throws Exception {

        if (amount == null
                || amount.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException(
                    "Payment amount must be positive.");
        }

        BigDecimal normalizedAmount =
                amount.setScale(
                        2,
                        RoundingMode.HALF_UP);

        long amountInPaise =
                normalizedAmount
                        .movePointRight(2)
                        .longValueExact();

        // Prepare receipt.
        String receipt = requestedReceipt;

        if (receipt == null || receipt.isBlank()) {
            receipt = "INSX_"
                    + UUID.randomUUID()
                            .toString()
                            .replace("-", "")
                            .substring(0, 12)
                            .toUpperCase();

        } else {
            receipt = receipt.trim();

            if (receipt.length() > 40) {
                throw new IllegalArgumentException(
                        "Payment receipt must not exceed 40 characters.");
            }
        }

        // Create Razorpay client.
        RazorpayClient razorpayClient =
                new RazorpayClient(
                        razorpayKeyId,
                        razorpayKeySecret);

        JSONObject orderRequest = new JSONObject();

        orderRequest.put("amount", amountInPaise);
        orderRequest.put("currency", currency);
        orderRequest.put("receipt", receipt);

        Order order =
                razorpayClient.orders.create(orderRequest);

        if (order == null) {
            throw new IllegalStateException(
                    "Unable to create Razorpay order.");
        }

        String orderId = order.get("id");

        if (orderId == null || orderId.isBlank()) {
            throw new IllegalStateException(
                    "Razorpay did not return an order ID.");
        }

        return new PaymentOrderResponse(
                orderId,
                razorpayKeyId,
                normalizedAmount,
                currency,
                receipt);
    }

    // =========================================================
    // VERIFY PAYMENT WITH EXPECTED AMOUNT
    // =========================================================

    public boolean verifyPayment(
            PaymentVerificationRequest request,
            BigDecimal expectedAmount) throws Exception {

        if (expectedAmount == null
                || expectedAmount.compareTo(BigDecimal.ZERO) <= 0) {
            return false;
        }

        final long expectedAmountInPaise;

        try {
            expectedAmountInPaise =
                    expectedAmount
                            .movePointRight(2)
                            .longValueExact();

        } catch (ArithmeticException exception) {
            return false;
        }

        return verifyPaymentInternally(
                request,
                expectedAmountInPaise);
    }

    // =========================================================
    // LEGACY VERIFICATION
    // =========================================================

    public boolean verifyPayment(
            PaymentVerificationRequest request) throws Exception {

        return verifyPaymentInternally(
                request,
                null);
    }

    // =========================================================
    // VERIFY RAZORPAY ORDER AND PAYMENT
    // =========================================================

    private boolean verifyPaymentInternally(
            PaymentVerificationRequest request,
            Long expectedAmountInPaise) throws Exception {

        if (!hasVerificationFields(request)) {
            return false;
        }

        String orderId =
                request.getRazorpayOrderId().trim();

        String paymentId =
                request.getRazorpayPaymentId().trim();

        String signature =
                request.getRazorpaySignature().trim();

        // Verify HMAC signature.
        String signatureData =
                orderId + "|" + paymentId;

        String generatedSignature =
                generateHmacSha256(
                        signatureData,
                        razorpayKeySecret);

        boolean signatureValid =
                MessageDigest.isEqual(
                        generatedSignature.getBytes(
                                StandardCharsets.UTF_8),
                        signature.toLowerCase(
                                java.util.Locale.ROOT).getBytes(
                                        StandardCharsets.UTF_8));

        if (!signatureValid) {
            return false;
        }

        // Fetch Razorpay order.
        RazorpayClient razorpayClient =
                new RazorpayClient(
                        razorpayKeyId,
                        razorpayKeySecret);

        Order order =
                razorpayClient.orders.fetch(orderId);

        if (order == null) {
            return false;
        }

        String fetchedOrderId = order.get("id");

        if (!orderId.equals(fetchedOrderId)) {
            return false;
        }

        String orderCurrency = order.get("currency");

        if (orderCurrency == null
                || !currency.equalsIgnoreCase(orderCurrency)) {
            return false;
        }

        // Validate order status.
        String orderStatus = order.get("status");

        if (!"paid".equalsIgnoreCase(orderStatus)) {
            return false;
        }

        // Validate order amount.
        Long orderAmountInPaise =
                readAmountInPaise(order.get("amount"));

        if (orderAmountInPaise == null
                || orderAmountInPaise <= 0) {
            return false;
        }

        if (expectedAmountInPaise != null
                && !expectedAmountInPaise.equals(
                        orderAmountInPaise)) {
            return false;
        }

        // Fetch Razorpay payment.
        Payment payment =
                razorpayClient.payments.fetch(paymentId);

        if (payment == null) {
            return false;
        }

        // Verify payment order.
        String paymentOrderId = payment.get("order_id");

        if (!orderId.equals(paymentOrderId)) {
            return false;
        }

        // Verify payment capture.
        String paymentStatus = payment.get("status");

        if (!"captured".equalsIgnoreCase(paymentStatus)) {
            return false;
        }

        // Verify payment amount.
        Long paymentAmountInPaise =
                readAmountInPaise(payment.get("amount"));

        if (paymentAmountInPaise == null
                || !orderAmountInPaise.equals(
                        paymentAmountInPaise)) {
            return false;
        }

        // Verify payment currency.
        String paymentCurrency = payment.get("currency");

        if (paymentCurrency == null
                || !currency.equalsIgnoreCase(paymentCurrency)
                || !orderCurrency.equalsIgnoreCase(paymentCurrency)) {
            return false;
        }

        return true;
    }

    // =========================================================
    // PARSE RAZORPAY AMOUNT
    // =========================================================

    private Long readAmountInPaise(Object amountObject) {

        if (amountObject == null) {
            return null;
        }

        try {
            return new BigDecimal(
                    String.valueOf(amountObject))
                            .longValueExact();

        } catch (NumberFormatException
                | ArithmeticException exception) {
            return null;
        }
    }

    // =========================================================
    // VALIDATE VERIFICATION REQUEST
    // =========================================================

    private boolean hasVerificationFields(
            PaymentVerificationRequest request) {

        return request != null
                && request.getRazorpayOrderId() != null
                && !request.getRazorpayOrderId().isBlank()
                && request.getRazorpayPaymentId() != null
                && !request.getRazorpayPaymentId().isBlank()
                && request.getRazorpaySignature() != null
                && !request.getRazorpaySignature().isBlank();
    }

    // =========================================================
    // VALIDATE AUTHENTICATED USER
    // =========================================================

    private void requireUsername(String username) {

        if (username == null || username.isBlank()) {
            throw new IllegalArgumentException(
                    "An authenticated user is required.");
        }
    }

    // =========================================================
    // GENERATE HMAC SHA256
    // =========================================================

    private String generateHmacSha256(
            String data,
            String secret) throws Exception {

        Mac mac = Mac.getInstance("HmacSHA256");

        SecretKeySpec secretKey =
                new SecretKeySpec(
                        secret.getBytes(StandardCharsets.UTF_8),
                        "HmacSHA256");

        mac.init(secretKey);

        byte[] hash =
                mac.doFinal(data.getBytes(StandardCharsets.UTF_8));

        StringBuilder result = new StringBuilder();

        for (byte b : hash) {
            result.append(
                    String.format("%02x", b & 0xff));
        }

        return result.toString();
    }
}
