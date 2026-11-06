
package com.htc.insurance.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

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

    private static final BigDecimal LONG_TERM_DISCOUNT =
            new BigDecimal("0.05");

    private static final BigDecimal MOTOR_GST_RATE =
            new BigDecimal("0.18");

    private static final BigDecimal ZERO =
            BigDecimal.ZERO.setScale(2, RoundingMode.HALF_UP);

    private static final long REFUND_WINDOW_HOURS = 24;

    private static final int MAX_APPLICATION_FIELD_LENGTH = 2000;

    private static final Set<String> HEALTH_PLANS = Set.of(
            "HLT-BASIC",
            "HLT-FAMILY",
            "HLT-PREMIUM"
    );

    private static final Set<String> LIFE_PLANS = Set.of(
            "LIF-ESSENTIAL",
            "LIF-FAMILY",
            "LIF-PREMIUM"
    );

    private static final Set<String> MOTOR_PLANS = Set.of(
            "MTR-BIKE",
            "MTR-CAR",
            "MTR-COMP"
    );

    private static final Set<String> FAMILY_PLANS = Set.of(
            "HLT-FAMILY",
            "LIF-FAMILY"
    );

    private static final Set<String> ALLOWED_GENDERS = Set.of(
            "Male",
            "Female",
            "Other"
    );

    private static final Set<String> ALLOWED_RELATIONS = Set.of(
            "Spouse",
            "Son",
            "Daughter",
            "Father",
            "Mother",
            "Brother",
            "Sister",
            "Other"
    );

    private static final Set<String> ALLOWED_OCCUPATIONS = Set.of(
            "Salaried",
            "Self-employed",
            "Business",
            "Government employee",
            "Professional",
            "Student",
            "Homemaker",
            "Retired",
            "Other"
    );

    private static final Set<String> ALLOWED_YES_NO = Set.of(
            "Yes",
            "No"
    );

    private static final Set<String> ALLOWED_FUEL_TYPES = Set.of(
            "Petrol",
            "Diesel",
            "Electric",
            "CNG",
            "Hybrid",
            "Other"
    );

    private static final Set<String> ALLOWED_VEHICLE_USAGES = Set.of(
            "Personal",
            "Commercial"
    );

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

        String orderId = purchaseDto.getRazorpayOrderId().trim();
        String paymentId = purchaseDto.getRazorpayPaymentId().trim();
        String signature = purchaseDto.getRazorpaySignature().trim();

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
                && !paymentId.equals(attempt.getRazorpayPaymentId())) {

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
        // VALIDATE PLAN-SPECIFIC APPLICATION
        // This is enforced by the backend, not just the UI.
        // =====================================================

        validatePlanApplication(plan, purchaseDto);

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

        purchase.setCoverageAmount(attempt.getCoverageAmount());
        purchase.setBasePremium(premium.basePremium);
        purchase.setDiscountAmount(premium.discountAmount);
        purchase.setTaxableAmount(premium.taxableAmount);
        purchase.setGstRate(premium.gstRate);
        purchase.setGstAmount(premium.gstAmount);
        purchase.setTotalPremium(premium.totalPremium);

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
    // PLAN-SPECIFIC APPLICATION VALIDATION
    // =========================================================

    private void validatePlanApplication(
            InsurancePlan plan,
            PurchasePolicyDto dto) {

        String planCode = normalizePlanCode(plan.getPlanCode());

        if (planCode == null) {
            throw new IllegalStateException(
                    "The selected insurance plan has no plan code.");
        }

        boolean health = HEALTH_PLANS.contains(planCode);
        boolean life = LIFE_PLANS.contains(planCode);
        boolean motor = MOTOR_PLANS.contains(planCode);
        boolean family = FAMILY_PLANS.contains(planCode);

        if (!health && !life && !motor) {
            throw new IllegalArgumentException(
                    "Application validation is not configured for plan: "
                    + planCode);
        }

        Map<String, Object> details = dto.getApplicationDetails();

        if (details == null || details.isEmpty()) {
            throw new IllegalArgumentException(
                    "Application details are required for this insurance plan.");
        }

        // The plan code and category sent by the UI are informational.
        // They must never override the plan loaded from the database.

        Object submittedCode = details.get("planCode");

        if (submittedCode != null
                && !planCode.equalsIgnoreCase(
                        String.valueOf(submittedCode).trim())) {

            throw new IllegalArgumentException(
                    "Application plan code does not match the selected plan.");
        }

        String expectedCategory =
                health ? "HEALTH" : life ? "LIFE" : "MOTOR";

        Object submittedCategory = details.get("planCategory");

        if (submittedCategory != null
                && !expectedCategory.equalsIgnoreCase(
                        String.valueOf(submittedCategory).trim())) {

            throw new IllegalArgumentException(
                    "Application category does not match the selected plan.");
        }

        if (health || life) {
            validatePersonDetails(details, life);
        }

        if (health) {
            validateHealthDetails(details);
        }

        if (life) {
            validateLifeDetails(details);
        }

        if (motor) {
            validateMotorDetails(details);
        }

        // Only family plans can have family member records.
        validateFamilyPlanMembers(
                planCode,
                dto.getFamilyMembers());

        // Validate and normalize all submitted values before JSON storage.
        dto.setApplicationDetails(
                sanitizeApplicationDetails(details));
    }

    // =========================================================
    // COMMON PERSON DETAILS
    // =========================================================

    private void validatePersonDetails(
            Map<String, Object> details,
            boolean life) {

        String name = requiredText(
                details,
                "applicantName",
                "Applicant full name is required.",
                100);

        String dateOfBirth = requiredText(
                details,
                "dateOfBirth",
                "Applicant date of birth is required.",
                10);

        String gender = requiredText(
                details,
                "gender",
                "Applicant gender is required.",
                30);

        String occupation = requiredText(
                details,
                "occupation",
                "Applicant occupation is required.",
                100);

        LocalDate dob = parseDate(
                dateOfBirth,
                "Applicant date of birth");

        if (dob.isAfter(LocalDate.now())) {
            throw new IllegalArgumentException(
                    "Applicant date of birth cannot be in the future.");
        }

        if (!ALLOWED_GENDERS.contains(gender)) {
            throw new IllegalArgumentException(
                    "Select a valid applicant gender.");
        }

        if (!ALLOWED_OCCUPATIONS.contains(occupation)) {
            throw new IllegalArgumentException(
                    "Select a valid applicant occupation.");
        }

        if (name.length() < 2) {
            throw new IllegalArgumentException(
                    "Applicant name must contain at least 2 characters.");
        }

        // Normalize the accepted text values.
        details.put("applicantName", name);
        details.put("dateOfBirth", dob.toString());
        details.put("gender", gender);
        details.put("occupation", occupation);
    }

    // =========================================================
    // HEALTH APPLICATION VALIDATION
    // =========================================================

    private void validateHealthDetails(
            Map<String, Object> details) {

        String diseaseAnswer = requiredText(
                details,
                "hasPreExistingDisease",
                "Please declare whether you have a pre-existing disease.",
                10);

        if (!ALLOWED_YES_NO.contains(diseaseAnswer)) {
            throw new IllegalArgumentException(
                    "Invalid pre-existing disease response.");
        }

        String medicalHistory = requiredText(
                details,
                "medicalHistory",
                "Medical history is required. Enter None if not applicable.",
                MAX_APPLICATION_FIELD_LENGTH);

        String medicationAnswer = requiredText(
                details,
                "takingMedication",
                "Please declare whether you are currently taking medication.",
                10);

        if (!ALLOWED_YES_NO.contains(medicationAnswer)) {
            throw new IllegalArgumentException(
                    "Invalid medication response.");
        }

        String diseases = optionalText(
                details,
                "preExistingDiseases",
                MAX_APPLICATION_FIELD_LENGTH);

        String medicationDetails = optionalText(
                details,
                "medicationDetails",
                MAX_APPLICATION_FIELD_LENGTH);

        if ("Yes".equals(diseaseAnswer) && diseases == null) {
            throw new IllegalArgumentException(
                    "Details of pre-existing diseases are required.");
        }

        if ("Yes".equals(medicationAnswer)
                && medicationDetails == null) {

            throw new IllegalArgumentException(
                    "Current medication details are required.");
        }

        if ("No".equals(diseaseAnswer) && diseases != null) {
            throw new IllegalArgumentException(
                    "Pre-existing disease details must be empty when the answer is No.");
        }

        if ("No".equals(medicationAnswer)
                && medicationDetails != null) {

            throw new IllegalArgumentException(
                    "Medication details must be empty when the answer is No.");
        }

        details.put("hasPreExistingDisease", diseaseAnswer);
        details.put("medicalHistory", medicalHistory);
        details.put("takingMedication", medicationAnswer);

        if (diseases != null) {
            details.put("preExistingDiseases", diseases);
        } else {
            details.remove("preExistingDiseases");
        }

        if (medicationDetails != null) {
            details.put("medicationDetails", medicationDetails);
        } else {
            details.remove("medicationDetails");
        }

        validateOptionalDecimal(
                details,
                "heightCm",
                new BigDecimal("30"),
                new BigDecimal("250"));

        validateOptionalDecimal(
                details,
                "weightKg",
                new BigDecimal("2"),
                new BigDecimal("400"));
    }

    // =========================================================
    // LIFE APPLICATION VALIDATION
    // =========================================================

    private void validateLifeDetails(
            Map<String, Object> details) {

        BigDecimal annualIncome = requiredDecimal(
                details,
                "annualIncome",
                "Annual income is required.");

        if (annualIncome.compareTo(BigDecimal.ZERO) <= 0
                || annualIncome.compareTo(
                        new BigDecimal("1000000000000")) > 0) {

            throw new IllegalArgumentException(
                    "Enter a valid annual income.");
        }

        String smokingStatus = requiredText(
                details,
                "smokingStatus",
                "Smoking status is required.",
                50);

        if (!Set.of(
                "Never smoked",
                "Former smoker",
                "Currently smoking"
        ).contains(smokingStatus)) {

            throw new IllegalArgumentException(
                    "Select a valid smoking status.");
        }

        String alcohol = requiredText(
                details,
                "alcoholConsumption",
                "Alcohol consumption status is required.",
                50);

        if (!Set.of(
                "Never",
                "Occasionally",
                "Regularly"
        ).contains(alcohol)) {

            throw new IllegalArgumentException(
                    "Select a valid alcohol consumption status.");
        }

        String hazardousActivities = requiredText(
                details,
                "hazardousActivities",
                "Please declare whether you participate in hazardous activities.",
                10);

        if (!ALLOWED_YES_NO.contains(hazardousActivities)) {
            throw new IllegalArgumentException(
                    "Invalid hazardous activities response.");
        }

        String medicalConditions = requiredText(
                details,
                "existingMedicalConditions",
                "Enter existing medical conditions or None.",
                MAX_APPLICATION_FIELD_LENGTH);

        String familyHistory = requiredText(
                details,
                "familyMedicalHistory",
                "Enter family medical history or None.",
                MAX_APPLICATION_FIELD_LENGTH);

        details.put("annualIncome", annualIncome.toPlainString());
        details.put("smokingStatus", smokingStatus);
        details.put("alcoholConsumption", alcohol);
        details.put("hazardousActivities", hazardousActivities);
        details.put("existingMedicalConditions", medicalConditions);
        details.put("familyMedicalHistory", familyHistory);
    }

    // =========================================================
    // MOTOR APPLICATION VALIDATION
    // =========================================================

    private void validateMotorDetails(
            Map<String, Object> details) {

        String registration = requiredText(
                details,
                "registrationNumber",
                "Vehicle registration number is required.",
                30);

        String make = requiredText(
                details,
                "vehicleMake",
                "Vehicle make is required.",
                100);

        String model = requiredText(
                details,
                "vehicleModel",
                "Vehicle model is required.",
                100);

        String yearValue = requiredText(
                details,
                "manufacturingYear",
                "Vehicle manufacturing year is required.",
                4);

        String fuel = requiredText(
                details,
                "fuelType",
                "Vehicle fuel type is required.",
                30);

        String usage = requiredText(
                details,
                "vehicleUsage",
                "Vehicle usage is required.",
                30);

        int year;

        try {
            year = Integer.parseInt(yearValue);
        } catch (NumberFormatException ex) {
            throw new IllegalArgumentException(
                    "Enter a valid vehicle manufacturing year.");
        }

        int currentYear = LocalDate.now().getYear();

        if (year < 1900 || year > currentYear) {
            throw new IllegalArgumentException(
                    "Vehicle manufacturing year is invalid.");
        }

        if (!ALLOWED_FUEL_TYPES.contains(fuel)) {
            throw new IllegalArgumentException(
                    "Select a valid vehicle fuel type.");
        }

        if (!ALLOWED_VEHICLE_USAGES.contains(usage)) {
            throw new IllegalArgumentException(
                    "Select a valid vehicle usage.");
        }

        String previousInsurance = requiredText(
                details,
                "previousInsurance",
                "Previous insurance declaration is required.",
                10);

        if (!ALLOWED_YES_NO.contains(previousInsurance)) {
            throw new IllegalArgumentException(
                    "Invalid previous insurance response.");
        }

        String previousInsurer = optionalText(
                details,
                "previousInsurer",
                150);

        String previousPolicyNumber = optionalText(
                details,
                "previousPolicyNumber",
                100);

        String previousExpiry = optionalText(
                details,
                "previousPolicyExpiryDate",
                10);

        if ("Yes".equals(previousInsurance)
                && previousInsurer == null) {

            throw new IllegalArgumentException(
                    "Previous insurance company is required.");
        }

        if ("No".equals(previousInsurance)
                && (
                    previousInsurer != null ||
                    previousPolicyNumber != null ||
                    previousExpiry != null
                )) {

            throw new IllegalArgumentException(
                    "Previous insurance details must be empty when the answer is No.");
        }

        if (previousExpiry != null) {
            LocalDate expiry = parseDate(
                    previousExpiry,
                    "Previous policy expiry date");

            details.put(
                    "previousPolicyExpiryDate",
                    expiry.toString());
        }

        String previousClaims = requiredText(
                details,
                "previousClaims",
                "Previous claims declaration is required.",
                10);

        if (!ALLOWED_YES_NO.contains(previousClaims)) {
            throw new IllegalArgumentException(
                    "Invalid previous claims response.");
        }

        String claimDetails = optionalText(
                details,
                "claimDetails",
                MAX_APPLICATION_FIELD_LENGTH);

        if ("Yes".equals(previousClaims) && claimDetails == null) {
            throw new IllegalArgumentException(
                    "Previous claim details are required.");
        }

        if ("No".equals(previousClaims) && claimDetails != null) {
            throw new IllegalArgumentException(
                    "Previous claim details must be empty when the answer is No.");
        }

        details.put("registrationNumber", registration.toUpperCase(Locale.ROOT));
        details.put("vehicleMake", make);
        details.put("vehicleModel", model);
        details.put("manufacturingYear", String.valueOf(year));
        details.put("fuelType", fuel);
        details.put("vehicleUsage", usage);
        details.put("previousInsurance", previousInsurance);
        details.put("previousClaims", previousClaims);

        String variant = optionalText(
                details,
                "vehicleVariant",
                100);

        if (variant != null) {
            details.put("vehicleVariant", variant);
        } else {
            details.remove("vehicleVariant");
        }

        if (previousInsurer != null) {
            details.put("previousInsurer", previousInsurer);
        } else {
            details.remove("previousInsurer");
        }

        if (previousPolicyNumber != null) {
            details.put("previousPolicyNumber", previousPolicyNumber);
        } else {
            details.remove("previousPolicyNumber");
        }

        if (claimDetails != null) {
            details.put("claimDetails", claimDetails);
        } else {
            details.remove("claimDetails");
        }
    }

    // =========================================================
    // FAMILY PLAN VALIDATION
    // =========================================================

    private void validateFamilyPlanMembers(
            String planCode,
            List<PurchasePolicyDto.FamilyMemberDto> members) {

        boolean familyPlan = FAMILY_PLANS.contains(planCode);

        if (!familyPlan) {

            if (members != null && !members.isEmpty()) {
                throw new IllegalArgumentException(
                        "Family members can only be submitted for a family insurance plan.");
            }

            return;
        }

        if (members == null || members.isEmpty()) {
            throw new IllegalArgumentException(
                    "Add at least one family member for this family plan.");
        }

        if (members.size() > 20) {
            throw new IllegalArgumentException(
                    "A maximum of 20 family members can be added.");
        }

        for (int index = 0; index < members.size(); index++) {

            PurchasePolicyDto.FamilyMemberDto member =
                    members.get(index);

            if (member == null) {
                throw new IllegalArgumentException(
                        "Family member " + (index + 1)
                        + " contains invalid details.");
            }

            String name = requiredMemberText(
                    member.getName(),
                    "Family member " + (index + 1) + " name",
                    100);

            String relation = requiredMemberText(
                    member.getRelation(),
                    "Family member " + (index + 1) + " relationship",
                    50);

            String gender = requiredMemberText(
                    member.getGender(),
                    "Family member " + (index + 1) + " gender",
                    30);

            String occupation = requiredMemberText(
                    member.getOccupation(),
                    "Family member " + (index + 1) + " occupation",
                    100);

            if (member.getDateOfBirth() == null) {
                throw new IllegalArgumentException(
                        "Date of birth is required for family member "
                        + (index + 1) + ".");
            }

            if (member.getDateOfBirth().isAfter(LocalDate.now())) {
                throw new IllegalArgumentException(
                        "Family member date of birth cannot be in the future.");
            }

            if (!ALLOWED_RELATIONS.contains(relation)) {
                throw new IllegalArgumentException(
                        "Select a valid relationship for family member "
                        + (index + 1) + ".");
            }

            if (!ALLOWED_GENDERS.contains(gender)) {
                throw new IllegalArgumentException(
                        "Select a valid gender for family member "
                        + (index + 1) + ".");
            }

            if (!ALLOWED_OCCUPATIONS.contains(occupation)) {
                throw new IllegalArgumentException(
                        "Select a valid occupation for family member "
                        + (index + 1) + ".");
            }

            member.setName(name);
            member.setRelation(relation);
            member.setGender(gender);
            member.setOccupation(occupation);
        }
    }

    // =========================================================
    // APPLICATION DETAILS SANITIZATION
    // =========================================================

    private Map<String, Object> sanitizeApplicationDetails(
            Map<String, Object> details) {

        Map<String, Object> result = new LinkedHashMap<>();

        for (Map.Entry<String, Object> entry : details.entrySet()) {

            String key = entry.getKey();

            if (key == null || key.isBlank()) {
                continue;
            }

            Object value = entry.getValue();

            if (value == null) {
                continue;
            }

            if (value instanceof String text) {

                String trimmed = text.trim();

                if (trimmed.isEmpty()) {
                    continue;
                }

                if (trimmed.length() > MAX_APPLICATION_FIELD_LENGTH) {
                    throw new IllegalArgumentException(
                            "Application field exceeds the allowed length: "
                            + key);
                }

                result.put(key, trimmed);

            } else if (
                    value instanceof Number ||
                    value instanceof Boolean
            ) {

                result.put(key, value);

            } else {
                throw new IllegalArgumentException(
                        "Unsupported value in application field: " + key);
            }
        }

        return result;
    }

    // =========================================================
    // APPLICATION FIELD HELPERS
    // =========================================================

    private String requiredText(
            Map<String, Object> details,
            String key,
            String message,
            int maxLength) {

        String value = optionalText(details, key, maxLength);

        if (value == null) {
            throw new IllegalArgumentException(message);
        }

        return value;
    }

    private String optionalText(
            Map<String, Object> details,
            String key,
            int maxLength) {

        Object raw = details.get(key);

        if (raw == null) {
            return null;
        }

        if (!(raw instanceof String)) {
            throw new IllegalArgumentException(
                    "Invalid value for application field: " + key);
        }

        String value = ((String) raw).trim();

        if (value.isEmpty()) {
            return null;
        }

        if (value.length() > maxLength) {
            throw new IllegalArgumentException(
                    "Application field exceeds the allowed length: " + key);
        }

        return value;
    }

    private BigDecimal requiredDecimal(
            Map<String, Object> details,
            String key,
            String message) {

        String value = requiredText(
                details,
                key,
                message,
                30);

        try {
            return new BigDecimal(value);
        } catch (NumberFormatException ex) {
            throw new IllegalArgumentException(
                    "Enter a valid numeric value for " + key + ".");
        }
    }

    private void validateOptionalDecimal(
            Map<String, Object> details,
            String key,
            BigDecimal minimum,
            BigDecimal maximum) {

        String value = optionalText(details, key, 30);

        if (value == null) {
            details.remove(key);
            return;
        }

        BigDecimal number;

        try {
            number = new BigDecimal(value);
        } catch (NumberFormatException ex) {
            throw new IllegalArgumentException(
                    "Enter a valid numeric value for " + key + ".");
        }

        if (number.compareTo(minimum) < 0
                || number.compareTo(maximum) > 0) {

            throw new IllegalArgumentException(
                    "Enter a valid value for " + key + ".");
        }

        details.put(key, number.stripTrailingZeros().toPlainString());
    }

    private LocalDate parseDate(
            String value,
            String fieldName) {

        try {
            return LocalDate.parse(value);
        } catch (RuntimeException ex) {
            throw new IllegalArgumentException(
                    fieldName + " must be a valid date in YYYY-MM-DD format.");
        }
    }

    private String requiredMemberText(
            String value,
            String fieldName,
            int maxLength) {

        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(
                    fieldName + " is required.");
        }

        String result = value.trim();

        if (result.length() > maxLength) {
            throw new IllegalArgumentException(
                    fieldName + " exceeds the allowed length.");
        }

        return result;
    }

    private String normalizePlanCode(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }

        return value.trim().toUpperCase(Locale.ROOT);
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
                    "Policy duration must be between 1 and 5 years.");
        }

        if (isBlank(dto.getRazorpayOrderId())
                || isBlank(dto.getRazorpayPaymentId())
                || isBlank(dto.getRazorpaySignature())) {

            throw new IllegalArgumentException(
                    "Razorpay order ID, payment ID "
                    + "and signature are required.");
        }

        if (isBlank(dto.getNomineeName())
                || isBlank(dto.getNomineeRelation())
                || isBlank(dto.getNomineeContact())) {

            throw new IllegalArgumentException(
                    "Nominee name, relationship and contact are required.");
        }

        if (!dto.getNomineeContact().trim().matches("^[6-9]\\d{9}$")) {
            throw new IllegalArgumentException(
                    "Enter a valid 10-digit nominee mobile number.");
        }

        validateFamilyMembers(dto.getFamilyMembers());
    }

    // =========================================================
    // GENERAL FAMILY MEMBER VALIDATION
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

        if (!paymentId.equals(purchase.getRazorpayPaymentId())) {
            throw new IllegalStateException(
                    "Payment reference does not match "
                    + "the existing purchase.");
        }

        if (!"PAID".equalsIgnoreCase(purchase.getPaymentStatus())) {
            throw new IllegalStateException(
                    "Existing purchase is not marked as paid.");
        }
    }

    // =========================================================
    // PREMIUM CALCULATION
    // Matches PaymentService exactly
    // =========================================================

    private PremiumBreakdown calculatePremium(
            InsurancePlan plan,
            BigDecimal coverage,
            Integer durationYears) {

        if (plan == null
                || plan.getBaseCoverage() == null
                || plan.getBaseCoverage()
                        .compareTo(BigDecimal.ZERO) <= 0
                || plan.getBasePremium() == null
                || plan.getBasePremium()
                        .compareTo(BigDecimal.ZERO) <= 0) {

            throw new IllegalStateException(
                    "Insurance plan pricing is invalid.");
        }

        if (durationYears == null
                || durationYears < 1
                || durationYears > 5) {

            throw new IllegalArgumentException(
                    "Policy duration must be between 1 and 5 years.");
        }

        BigDecimal minimumCoverage = plan.getBaseCoverage();
        BigDecimal maximumCoverage =
                MAXIMUM_COVERAGE.max(minimumCoverage);

        if (coverage == null
                || coverage.compareTo(minimumCoverage) < 0
                || coverage.compareTo(maximumCoverage) > 0) {

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

        BigDecimal discountAmount = ZERO;

        if (durationYears >= 2) {
            discountAmount = basePremium
                    .multiply(LONG_TERM_DISCOUNT)
                    .setScale(2, RoundingMode.HALF_UP);
        }

        BigDecimal taxableAmount = basePremium
                .subtract(discountAmount)
                .setScale(2, RoundingMode.HALF_UP);

        BigDecimal gstRate = getGstRate(plan);

        BigDecimal gstAmount = taxableAmount
                .multiply(gstRate)
                .setScale(2, RoundingMode.HALF_UP);

        BigDecimal totalPremium = taxableAmount
                .add(gstAmount)
                .setScale(2, RoundingMode.HALF_UP);

        return new PremiumBreakdown(
                basePremium,
                discountAmount,
                taxableAmount,
                gstRate,
                gstAmount,
                totalPremium);
    }

    // =========================================================
    // GST CLASSIFICATION
    // Must match PaymentService
    // =========================================================

    private BigDecimal getGstRate(InsurancePlan plan) {

        if (plan == null
                || plan.getPlanCode() == null
                || plan.getPlanCode().isBlank()) {

            throw new IllegalStateException(
                    "GST classification is unavailable for this plan.");
        }

        String planCode = plan.getPlanCode()
                .trim()
                .toUpperCase(Locale.ROOT);

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

            dto.setPolicyNumber(policy.getPolicyNumber());
            dto.setCoveredTypes(policy.getCoveredTypes());
            dto.setDurationYears(policy.getDurationYears());

            if (policy.getPolicyHolder() != null
                    && policy.getPolicyHolder().getUser() != null) {

                dto.setUsername(
                        policy.getPolicyHolder()
                                .getUser()
                                .getUsername());
            }
        }

        dto.setCoverageAmount(purchase.getCoverageAmount());

        dto.setNomineeName(purchase.getNomineeName());
        dto.setNomineeRelation(purchase.getNomineeRelation());
        dto.setNomineeContact(purchase.getNomineeContact());

        dto.setApplicationDetails(
                copyApplicationDetails(
                        purchase.getApplicationDetails()));

        dto.setFamilyMembers(
                toFamilyMemberDtos(
                        purchase.getFamilyMembers()));

        dto.setPaymentMethod(purchase.getPaymentMethod());
        dto.setPaymentStatus(purchase.getPaymentStatus());
        dto.setTransactionId(purchase.getTransactionId());
        dto.setRazorpayOrderId(purchase.getRazorpayOrderId());
        dto.setRazorpayPaymentId(purchase.getRazorpayPaymentId());

        dto.setBasePremium(purchase.getBasePremium());
        dto.setDiscountAmount(purchase.getDiscountAmount());
        dto.setTaxableAmount(purchase.getTaxableAmount());
        dto.setGstRate(purchase.getGstRate());
        dto.setGstAmount(purchase.getGstAmount());
        dto.setTotalPremium(purchase.getTotalPremium());

        dto.setPaymentDate(purchase.getPaymentDate());
        dto.setPaymentDateTime(purchase.getPaymentDateTime());
        dto.setPurchaseDate(purchase.getPurchaseDate());
        dto.setCreatedAt(purchase.getCreatedAt());

        dto.setRefundStatus(purchase.getRefundStatus());
        dto.setRefundId(purchase.getRefundId());
        dto.setRefundAmount(purchase.getRefundAmount());
        dto.setRefundReason(purchase.getRefundReason());
        dto.setRefundDateTime(purchase.getRefundDateTime());

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
                && purchase.getTotalPremium().compareTo(
                        BigDecimal.ZERO) > 0
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
