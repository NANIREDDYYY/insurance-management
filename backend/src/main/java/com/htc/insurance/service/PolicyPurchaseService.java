
package com.htc.insurance.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import lombok.RequiredArgsConstructor;

import com.htc.insurance.dao.ClaimsDao;
import com.htc.insurance.dao.PolicyDao;
import com.htc.insurance.dao.PolicyHolderDao;
import com.htc.insurance.dao.PolicyPurchaseDao;
import com.htc.insurance.dao.UserDao;

import com.htc.insurance.dto.PaymentVerificationRequest;
import com.htc.insurance.dto.PurchasePolicyDto;

import com.htc.insurance.entity.InsurancePlan;
import com.htc.insurance.entity.PaymentAttempt;
import com.htc.insurance.entity.PaymentAttemptStatus;
import com.htc.insurance.entity.Policy;
import com.htc.insurance.entity.PolicyHolder;
import com.htc.insurance.entity.PolicyPurchase;
import com.htc.insurance.entity.User;

import com.htc.insurance.repository.InsurancePlanRepository;
import com.htc.insurance.repository.RefundAttemptRepository;

@Service
@RequiredArgsConstructor
public class PolicyPurchaseService {

    private static final Logger log =
            LoggerFactory.getLogger(PolicyPurchaseService.class);

    private static final BigDecimal MAXIMUM_COVERAGE =
            new BigDecimal("10000000.00");

    private static final BigDecimal GST_RATE =
            new BigDecimal("0.00");

    private static final long REFUND_WINDOW_HOURS = 24;

    private final ClaimsDao claimsDao;
    private final RefundAttemptRepository refundAttemptRepository;
    private final PolicyDao policyDao;
    private final PolicyHolderDao policyHolderDao;
    private final UserDao userDao;
    private final PolicyPurchaseDao policyPurchaseDao;
    private final PaymentService paymentService;
    private final PaymentAttemptService paymentAttemptService;
    private final InsurancePlanRepository insurancePlanRepository;

    // =========================================================
    // USER - PURCHASE INSURANCE POLICY
    // =========================================================

    @Transactional(rollbackFor = Exception.class)
    public PurchasePolicyDto purchasePolicy(
            PurchasePolicyDto purchaseDto,
            Authentication authentication) {

        validateAuthentication(authentication);

        if (purchaseDto == null) {
            throw new IllegalArgumentException(
                    "Purchase details are required.");
        }

        String username = authentication.getName();

        // =====================================================
        // VALIDATE CUSTOMER
        // =====================================================

        User user = userDao.getUserByUsername(username);

        if (user == null) {
            throw new IllegalArgumentException(
                    "Customer account was not found.");
        }

        if (!Boolean.TRUE.equals(user.getIsActive())) {
            throw new IllegalStateException(
                    "Customer account is inactive.");
        }

        PolicyHolder holder =
                policyHolderDao.getPolicyHolderByUsername(username);

        if (holder == null) {
            throw new IllegalStateException(
                    "Policy-holder profile was not found.");
        }

        if (holder.getUser() == null
                || !Objects.equals(
                        holder.getUser().getUserId(),
                        user.getUserId())) {

            throw new AccessDeniedException(
                    "Policy-holder ownership verification failed.");
        }

        validatePurchaseRequest(purchaseDto);

        String orderId =
                purchaseDto.getRazorpayOrderId().trim();

        String paymentId =
                purchaseDto.getRazorpayPaymentId().trim();

        String signature =
                purchaseDto.getRazorpaySignature().trim();

        // =====================================================
        // PAYMENT ATTEMPT
        // =====================================================

        PaymentAttempt attempt =
                paymentAttemptService.getAttemptByOrderId(orderId);

        if (attempt == null) {
            throw new IllegalStateException(
                    "Payment attempt was not found.");
        }

        String purchaseType = attempt.getPurchaseType();

        if (purchaseType != null
                && !purchaseType.isBlank()
                && !"NEW".equalsIgnoreCase(purchaseType)) {

            throw new IllegalStateException(
                    "Renewal payment orders cannot be used for a normal "
                    + "policy purchase. Use renewal confirmation.");
        }

        if (attempt.getRenewalSourcePolicyNumber() != null) {
            throw new IllegalStateException(
                    "A renewal-linked payment order cannot be used "
                    + "for a normal policy purchase.");
        }

        if (!username.equals(attempt.getUsername())) {
            throw new AccessDeniedException(
                    "Payment order belongs to another customer.");
        }

        if (!Objects.equals(
                purchaseDto.getPlanId(),
                attempt.getPlanId())) {

            throw new IllegalArgumentException(
                    "Plan does not match the payment order.");
        }

        if (!Objects.equals(
                purchaseDto.getDurationYears(),
                attempt.getDurationYears())) {

            throw new IllegalArgumentException(
                    "Duration does not match the payment order.");
        }

        if (attempt.getCoverageAmount() == null
                || purchaseDto.getCoverageAmount().compareTo(
                        attempt.getCoverageAmount()) != 0) {

            throw new IllegalArgumentException(
                    "Coverage does not match the payment order.");
        }

        if (!"INR".equalsIgnoreCase(attempt.getCurrency())) {
            throw new IllegalArgumentException(
                    "Unsupported payment currency.");
        }

        // =====================================================
        // CHECK EXISTING PURCHASE
        // =====================================================

        PolicyPurchase existing =
                policyPurchaseDao.getPurchaseByRazorpayOrderId(orderId);

        if (existing != null) {

            validateExistingPurchase(
                    existing,
                    username,
                    paymentId);

            return toDto(existing);
        }

        if (attempt.getRazorpayPaymentId() != null
                && !paymentId.equals(
                        attempt.getRazorpayPaymentId())) {

            throw new IllegalStateException(
                    "Payment ID conflicts with the recorded attempt.");
        }

        if (attempt.getStatus()
                == PaymentAttemptStatus.PURCHASE_COMPLETED) {

            throw new IllegalStateException(
                    "Payment attempt is completed, but its "
                    + "purchase record could not be found.");
        }

        // =====================================================
        // LOAD PLAN
        // =====================================================

        InsurancePlan plan = insurancePlanRepository
                .findById(attempt.getPlanId())
                .orElseThrow(() -> new IllegalArgumentException(
                        "Insurance plan was not found."));

        if (!Boolean.TRUE.equals(plan.getIsActive())) {
            throw new IllegalStateException(
                    "Insurance plan is inactive.");
        }

        // =====================================================
        // CALCULATE PREMIUM
        // =====================================================

        PremiumBreakdown premium = calculatePremium(
                plan,
                attempt.getCoverageAmount(),
                attempt.getDurationYears());

        if (attempt.getCalculatedPremium() == null
                || premium.totalPremium.compareTo(
                        attempt.getCalculatedPremium()) != 0) {

            throw new IllegalStateException(
                    "Calculated premium does not match "
                    + "the payment attempt.");
        }

        // =====================================================
        // VERIFY RAZORPAY PAYMENT
        // =====================================================

        PaymentVerificationRequest verification =
                new PaymentVerificationRequest();

        verification.setRazorpayOrderId(orderId);
        verification.setRazorpayPaymentId(paymentId);
        verification.setRazorpaySignature(signature);

        try {

            boolean verified = paymentService.verifyPayment(
                    verification,
                    attempt.getCalculatedPremium());

            if (!verified) {
                throw new IllegalStateException(
                        "Payment verification was unsuccessful.");
            }

        } catch (Exception ex) {

            throw new IllegalStateException(
                    "Razorpay payment verification failed.",
                    ex);
        }

        paymentAttemptService.markPaymentVerified(
                orderId,
                paymentId);

        // =====================================================
        // CREATE POLICY
        // =====================================================

        LocalDate today = LocalDate.now();
        LocalDateTime now = LocalDateTime.now();

        Policy policy = new Policy();

        policy.setCoveredTypes(plan.getCoveredType());
        policy.setIsActive(true);
        policy.setStartDate(today);
        policy.setDurationYears(attempt.getDurationYears());

        policy.setExpiryDate(
                today.plusYears(attempt.getDurationYears())
                        .minusDays(1));

        policy.setPolicyHolder(holder);

        Policy savedPolicy = policyDao.savePolicy(policy);

        // =====================================================
        // SAVE PURCHASE
        // =====================================================

        PolicyPurchase purchase = new PolicyPurchase();

        purchase.setPolicy(savedPolicy);
        purchase.setPlanId(attempt.getPlanId());

        // =====================================================
        // COVERAGE AND PREMIUM
        // =====================================================

        purchase.setCoverageAmount(
                attempt.getCoverageAmount());

        purchase.setBasePremium(
                premium.basePremium);

        purchase.setDiscountAmount(
                premium.discountAmount);

        purchase.setTaxableAmount(
                premium.taxableAmount);

        purchase.setGstRate(
                premium.gstRate);

        purchase.setGstAmount(
                premium.gstAmount);

        purchase.setTotalPremium(
                premium.totalPremium);

        // =====================================================
        // NOMINEE
        // =====================================================

        purchase.setNomineeName(
                trimToNull(purchaseDto.getNomineeName()));

        purchase.setNomineeRelation(
                trimToNull(purchaseDto.getNomineeRelation()));

        purchase.setNomineeContact(
                trimToNull(purchaseDto.getNomineeContact()));

        // =====================================================
        // APPLICATION DETAILS
        // =====================================================

        purchase.setApplicationDetails(
                copyApplicationDetails(
                        purchaseDto.getApplicationDetails()));

        // =====================================================
        // FAMILY MEMBERS
        // =====================================================

        purchase.setFamilyMembers(
                toFamilyMemberMaps(
                        purchaseDto.getFamilyMembers()));

        // =====================================================
        // PAYMENT DETAILS
        // =====================================================

        purchase.setPaymentMethod("RAZORPAY");
        purchase.setPaymentStatus("PAID");

        purchase.setTransactionId(paymentId);
        purchase.setRazorpayOrderId(orderId);
        purchase.setRazorpayPaymentId(paymentId);

        purchase.setPaymentDate(today);
        purchase.setPaymentDateTime(now);
        purchase.setPurchaseDate(today);
        purchase.setCreatedAt(now);

        purchase.setRefundStatus("NOT_REFUNDED");

        PolicyPurchase savedPurchase;

        try {

            savedPurchase =
                    policyPurchaseDao.savePurchase(purchase);

        } catch (DataIntegrityViolationException ex) {

            log.warn(
                    "Purchase persistence conflict for order {}",
                    orderId,
                    ex);

            throw ex;
        }

        // =====================================================
        // COMPLETE ATTEMPT AFTER COMMIT
        // =====================================================

        if (!TransactionSynchronizationManager
                .isSynchronizationActive()) {

            throw new IllegalStateException(
                    "Purchase transaction synchronization "
                    + "is unavailable.");
        }

        TransactionSynchronizationManager
                .registerSynchronization(
                        new TransactionSynchronization() {

                            @Override
                            public void afterCommit() {

                                try {

                                    paymentAttemptService
                                            .markPurchaseCompleted(
                                                    orderId,
                                                    paymentId);

                                } catch (Exception ex) {

                                    log.error(
                                            "Purchase committed, but payment "
                                            + "attempt completion requires "
                                            + "reconciliation. Order: {}",
                                            orderId,
                                            ex);
                                }
                            }
                        });

        log.info(
                "Insurance policy purchase completed. "
                + "Purchase ID: {}, Order ID: {}",
                savedPurchase.getPurchaseId(),
                orderId);

        return toDto(savedPurchase);
    }

    // =========================================================
    // ADMIN - ALL PURCHASES
    // =========================================================

    @Transactional(readOnly = true)
    public List<PurchasePolicyDto> getAllPurchases() {

        return policyPurchaseDao.getAllPurchases()
                .stream()
                .map(this::toDto)
                .toList();
    }

    // =========================================================
    // USER - MY PURCHASES
    // =========================================================

    @Transactional(readOnly = true)
    public List<PurchasePolicyDto> getMyPurchases(
            Authentication authentication) {

        validateAuthentication(authentication);

        return policyPurchaseDao
                .getPurchasesByUsername(authentication.getName())
                .stream()
                .map(this::toDto)
                .toList();
    }

    // =========================================================
    // AUTHENTICATION VALIDATION
    // =========================================================

    private void validateAuthentication(
            Authentication authentication) {

        if (authentication == null
                || !authentication.isAuthenticated()
                || authentication.getName() == null
                || authentication.getName().isBlank()) {

            throw new AccessDeniedException(
                    "Authentication is required.");
        }
    }

    // =========================================================
    // PURCHASE REQUEST VALIDATION
    // =========================================================

    private void validatePurchaseRequest(
            PurchasePolicyDto dto) {

        if (dto.getPlanId() == null) {
            throw new IllegalArgumentException(
                    "Insurance plan is required.");
        }

        if (dto.getCoverageAmount() == null
                || dto.getCoverageAmount().compareTo(BigDecimal.ZERO) <= 0
                || dto.getCoverageAmount().compareTo(MAXIMUM_COVERAGE) > 0) {

            throw new IllegalArgumentException(
                    "Coverage must be positive and must not exceed INR 1 crore.");
        }

        if (dto.getDurationYears() == null
                || dto.getDurationYears() < 1
                || dto.getDurationYears() > 5) {

            throw new IllegalArgumentException(
                    "Policy duration must be between "
                    + "1 and 5 years.");
        }

        if (isBlank(dto.getRazorpayOrderId())
                || isBlank(dto.getRazorpayPaymentId())
                || isBlank(dto.getRazorpaySignature())) {

            throw new IllegalArgumentException(
                    "Razorpay order ID, payment ID "
                    + "and signature are required.");
        }

        validateFamilyMembers(dto.getFamilyMembers());
    }

    // =========================================================
    // FAMILY MEMBER VALIDATION
    // =========================================================

    private void validateFamilyMembers(
            List<PurchasePolicyDto.FamilyMemberDto> members) {

        if (members == null) {
            return;
        }

        if (members.size() > 20) {
            throw new IllegalArgumentException(
                    "A maximum of 20 family members can be added.");
        }

        for (PurchasePolicyDto.FamilyMemberDto member : members) {

            if (member == null
                    || isBlank(member.getName())
                    || isBlank(member.getRelation())) {

                throw new IllegalArgumentException(
                        "Every family member must have a name and relation.");
            }

            if (member.getName().trim().length() > 100
                    || member.getRelation().trim().length() > 50
                    || (member.getGender() != null
                        && member.getGender().length() > 30)
                    || (member.getOccupation() != null
                        && member.getOccupation().length() > 100)) {

                throw new IllegalArgumentException(
                        "Family member details exceed the allowed length.");
            }

            if (member.getDateOfBirth() != null
                    && member.getDateOfBirth().isAfter(LocalDate.now())) {

                throw new IllegalArgumentException(
                        "Family member date of birth cannot be in the future.");
            }
        }
    }

    // =========================================================
    // EXISTING PURCHASE VALIDATION
    // =========================================================

    private void validateExistingPurchase(
            PolicyPurchase purchase,
            String username,
            String paymentId) {

        if (purchase.getPolicy() == null
                || purchase.getPolicy().getPolicyHolder() == null
                || purchase.getPolicy()
                        .getPolicyHolder().getUser() == null) {

            throw new IllegalStateException(
                    "Existing purchase ownership is invalid.");
        }

        String owner = purchase.getPolicy()
                .getPolicyHolder()
                .getUser()
                .getUsername();

        if (!username.equals(owner)) {
            throw new AccessDeniedException(
                    "Purchase belongs to another customer.");
        }

        if (!paymentId.equals(
                purchase.getRazorpayPaymentId())) {

            throw new IllegalStateException(
                    "Payment reference does not match "
                    + "the existing purchase.");
        }

        if (!"PAID".equalsIgnoreCase(
                purchase.getPaymentStatus())) {

            throw new IllegalStateException(
                    "Existing purchase is not marked as paid.");
        }
    }

    // =========================================================
    // PREMIUM CALCULATION
    // Matches the shared PaymentService pricing rules
    // =========================================================

    private PremiumBreakdown calculatePremium(
            InsurancePlan plan,
            BigDecimal coverage,
            Integer durationYears) {

        if (plan.getBaseCoverage() == null
                || plan.getBaseCoverage()
                        .compareTo(BigDecimal.ZERO) <= 0
                || plan.getBasePremium() == null
                || plan.getBasePremium()
                        .compareTo(BigDecimal.ZERO) <= 0) {

            throw new IllegalStateException(
                    "Insurance plan pricing is invalid.");
        }

        if (coverage == null
                || coverage.compareTo(plan.getBaseCoverage()) < 0
                || coverage.compareTo(MAXIMUM_COVERAGE) > 0) {

            throw new IllegalArgumentException(
                    "Coverage is outside the selected plan's allowed range.");
        }

        BigDecimal coverageFactor = coverage.divide(
                plan.getBaseCoverage(),
                10,
                RoundingMode.HALF_UP);

        BigDecimal basePremium = plan.getBasePremium()
                .multiply(coverageFactor)
                .multiply(BigDecimal.valueOf(durationYears))
                .setScale(2, RoundingMode.HALF_UP);

        BigDecimal discountAmount = BigDecimal.ZERO
                .setScale(2, RoundingMode.HALF_UP);

        BigDecimal taxableAmount = basePremium
                .subtract(discountAmount)
                .setScale(2, RoundingMode.HALF_UP);

        BigDecimal gstAmount = taxableAmount
                .multiply(GST_RATE)
                .setScale(2, RoundingMode.HALF_UP);

        BigDecimal totalPremium = taxableAmount
                .add(gstAmount)
                .setScale(2, RoundingMode.HALF_UP);

        return new PremiumBreakdown(
                basePremium,
                discountAmount,
                taxableAmount,
                GST_RATE,
                gstAmount,
                totalPremium);
    }

    // =========================================================
    // ENTITY TO DTO
    // =========================================================

    private PurchasePolicyDto toDto(
            PolicyPurchase purchase) {

        PurchasePolicyDto dto = new PurchasePolicyDto();

        dto.setPurchaseId(purchase.getPurchaseId());
        dto.setPlanId(purchase.getPlanId());

        PolicyPurchase originalPurchase =
                purchase.getRenewedFromPurchase();

        if (originalPurchase != null) {

            dto.setRenewedFromPurchaseId(
                    originalPurchase.getPurchaseId());

            Policy originalPolicy = originalPurchase.getPolicy();

            if (originalPolicy != null) {
                dto.setRenewedFromPolicyNumber(
                        originalPolicy.getPolicyNumber());
            }
        }

        Policy policy = purchase.getPolicy();

        if (policy != null) {

            dto.setPolicyNumber(
                    policy.getPolicyNumber());

            dto.setCoveredTypes(
                    policy.getCoveredTypes());

            dto.setDurationYears(
                    policy.getDurationYears());

            if (policy.getPolicyHolder() != null
                    && policy.getPolicyHolder().getUser() != null) {

                dto.setUsername(
                        policy.getPolicyHolder()
                                .getUser()
                                .getUsername());
            }
        }

        dto.setCoverageAmount(
                purchase.getCoverageAmount());

        dto.setNomineeName(
                purchase.getNomineeName());

        dto.setNomineeRelation(
                purchase.getNomineeRelation());

        dto.setNomineeContact(
                purchase.getNomineeContact());

        // =====================================================
        // APPLICATION DETAILS
        // =====================================================

        dto.setApplicationDetails(
                copyApplicationDetails(
                        purchase.getApplicationDetails()));

        // =====================================================
        // FAMILY MEMBERS
        // =====================================================

        dto.setFamilyMembers(
                toFamilyMemberDtos(
                        purchase.getFamilyMembers()));

        // =====================================================
        // PAYMENT DETAILS
        // =====================================================

        dto.setPaymentMethod(
                purchase.getPaymentMethod());

        dto.setPaymentStatus(
                purchase.getPaymentStatus());

        dto.setTransactionId(
                purchase.getTransactionId());

        dto.setRazorpayOrderId(
                purchase.getRazorpayOrderId());

        dto.setRazorpayPaymentId(
                purchase.getRazorpayPaymentId());

        dto.setBasePremium(
                purchase.getBasePremium());

        dto.setDiscountAmount(
                purchase.getDiscountAmount());

        dto.setTaxableAmount(
                purchase.getTaxableAmount());

        dto.setGstRate(
                purchase.getGstRate());

        dto.setGstAmount(
                purchase.getGstAmount());

        dto.setTotalPremium(
                purchase.getTotalPremium());

        dto.setPaymentDate(
                purchase.getPaymentDate());

        dto.setPaymentDateTime(
                purchase.getPaymentDateTime());

        dto.setPurchaseDate(
                purchase.getPurchaseDate());

        dto.setCreatedAt(
                purchase.getCreatedAt());

        // =====================================================
        // REFUND DETAILS
        // =====================================================

        dto.setRefundStatus(
                purchase.getRefundStatus());

        dto.setRefundId(
                purchase.getRefundId());

        dto.setRefundAmount(
                purchase.getRefundAmount());

        dto.setRefundReason(
                purchase.getRefundReason());

        dto.setRefundDateTime(
                purchase.getRefundDateTime());

        LocalDateTime paidAt = purchase.getPaymentDateTime();

        LocalDateTime deadline = paidAt == null
                ? null
                : paidAt.plusHours(REFUND_WINDOW_HOURS);

        dto.setRefundDeadline(deadline);

        boolean eligible = false;

        String refundStatus = purchase.getRefundStatus();

        if (policy != null
                && policy.getPolicyNumber() != null
                && paidAt != null
                && !paidAt.isAfter(LocalDateTime.now())
                && LocalDateTime.now().isBefore(deadline)
                && "PAID".equalsIgnoreCase(purchase.getPaymentStatus())
                && "NOT_REFUNDED".equalsIgnoreCase(refundStatus)
                && !isBlank(purchase.getRazorpayPaymentId())
                && purchase.getTotalPremium() != null
                && purchase.getTotalPremium().compareTo(BigDecimal.ZERO) > 0
                && !refundAttemptRepository.existsByPurchaseId(
                        purchase.getPurchaseId())
                && !claimsDao.existsClaimsByPolicyNumber(
                        policy.getPolicyNumber())) {

            eligible = true;
        }

        dto.setRefundEligible(eligible);

        // Never expose a payment signature in responses.
        dto.setRazorpaySignature(null);

        return dto;
    }

    // =========================================================
    // APPLICATION DETAILS HELPERS
    // =========================================================

    private Map<String, Object> copyApplicationDetails(
            Map<String, Object> details) {

        if (details == null || details.isEmpty()) {
            return null;
        }

        return new LinkedHashMap<>(details);
    }

    // =========================================================
    // FAMILY MEMBER DTO TO ENTITY MAP
    // =========================================================

    private List<Map<String, Object>> toFamilyMemberMaps(
            List<PurchasePolicyDto.FamilyMemberDto> members) {

        if (members == null || members.isEmpty()) {
            return null;
        }

        List<Map<String, Object>> result = new ArrayList<>();

        for (PurchasePolicyDto.FamilyMemberDto member : members) {

            Map<String, Object> item = new LinkedHashMap<>();

            item.put("name", trimToNull(member.getName()));
            item.put("relation", trimToNull(member.getRelation()));
            item.put("dateOfBirth", member.getDateOfBirth());
            item.put("gender", trimToNull(member.getGender()));
            item.put("occupation", trimToNull(member.getOccupation()));

            result.add(item);
        }

        return result;
    }

    // =========================================================
    // FAMILY MEMBER ENTITY MAP TO DTO
    // =========================================================

    private List<PurchasePolicyDto.FamilyMemberDto> toFamilyMemberDtos(
            List<Map<String, Object>> members) {

        if (members == null || members.isEmpty()) {
            return null;
        }

        List<PurchasePolicyDto.FamilyMemberDto> result =
                new ArrayList<>();

        for (Map<String, Object> item : members) {

            if (item == null) {
                continue;
            }

            PurchasePolicyDto.FamilyMemberDto member =
                    new PurchasePolicyDto.FamilyMemberDto();

            member.setName(stringValue(item.get("name")));
            member.setRelation(stringValue(item.get("relation")));
            member.setDateOfBirth(
                    localDateValue(item.get("dateOfBirth")));
            member.setGender(stringValue(item.get("gender")));
            member.setOccupation(stringValue(item.get("occupation")));

            result.add(member);
        }

        return result;
    }

    private String stringValue(Object value) {

        if (value == null) {
            return null;
        }

        String result = String.valueOf(value);

        return result.isBlank() ? null : result;
    }

    private LocalDate localDateValue(Object value) {

        if (value == null) {
            return null;
        }

        if (value instanceof LocalDate date) {
            return date;
        }

        if (value instanceof java.sql.Date date) {
            return date.toLocalDate();
        }

        try {
            return LocalDate.parse(String.valueOf(value));
        } catch (RuntimeException ex) {
            log.warn(
                    "Could not convert stored family member date of birth: {}",
                    value);
            return null;
        }
    }

    // =========================================================
    // GENERAL HELPERS
    // =========================================================

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private String trimToNull(String value) {

        if (value == null || value.isBlank()) {
            return null;
        }

        return value.trim();
    }

    // =========================================================
    // PREMIUM BREAKDOWN
    // =========================================================

    private static class PremiumBreakdown {

        private final BigDecimal basePremium;
        private final BigDecimal discountAmount;
        private final BigDecimal taxableAmount;
        private final BigDecimal gstRate;
        private final BigDecimal gstAmount;
        private final BigDecimal totalPremium;

        private PremiumBreakdown(
                BigDecimal basePremium,
                BigDecimal discountAmount,
                BigDecimal taxableAmount,
                BigDecimal gstRate,
                BigDecimal gstAmount,
                BigDecimal totalPremium) {

            this.basePremium = basePremium;
            this.discountAmount = discountAmount;
            this.taxableAmount = taxableAmount;
            this.gstRate = gstRate;
            this.gstAmount = gstAmount;
            this.totalPremium = totalPremium;
        }
    }
}
