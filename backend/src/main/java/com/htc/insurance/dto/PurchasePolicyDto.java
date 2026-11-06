
package com.htc.insurance.dto;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Purchase, renewal, payment, refund and insurance
 * application details transfer object.
 */
@Getter
@Setter
@NoArgsConstructor
public class PurchasePolicyDto {

    // =========================================================
    // PURCHASE INFORMATION
    // =========================================================

    private Long purchaseId;
    private Long policyNumber;
    private Long planId;

    // =========================================================
    // CUSTOMER AND POLICY DETAILS
    // =========================================================

    private String username;
    private String coveredTypes;
    private Integer durationYears;
    private BigDecimal coverageAmount;

    // =========================================================
    // POLICY RENEWAL RELATIONSHIP
    // =========================================================

    private Long renewedFromPurchaseId;
    private Long renewedFromPolicyNumber;

    // =========================================================
    // NOMINEE INFORMATION
    // =========================================================

    private String nomineeName;
    private String nomineeRelation;
    private String nomineeContact;

    // =========================================================
    // INSURANCE APPLICATION DETAILS
    //
    // Flexible structure for plan-specific information:
    //
    // HEALTH:
    // applicant, dateOfBirth, gender, occupation,
    // medicalHistory, existingConditions, address
    //
    // FAMILY:
    // primaryApplicant, familyMembers, address
    //
    // VEHICLE:
    // vehicleRegistrationNumber, vehicleType,
    // registrationDetails, vehicleOwner, vehicleUsage
    //
    // OTHER PLANS:
    // Additional plan-specific application information.
    //
    // Vehicle lookup data must be verified by the backend.
    // Never trust frontend-supplied vehicle verification status.
    // =========================================================

    private Map<String, Object> applicationDetails;

    // =========================================================
    // FAMILY MEMBER INFORMATION
    // =========================================================

    private List<FamilyMemberDto> familyMembers;

    @Getter
    @Setter
    @NoArgsConstructor
    public static class FamilyMemberDto {

        private String name;
        private String relation;
        private LocalDate dateOfBirth;
        private String gender;
        private String occupation;
    }

    // =========================================================
    // PAYMENT METHOD
    // =========================================================

    private String paymentMethod;

    // =========================================================
    // PREMIUM BREAKDOWN
    // =========================================================

    private BigDecimal basePremium;
    private BigDecimal discountAmount;
    private BigDecimal taxableAmount;
    private BigDecimal gstRate;
    private BigDecimal gstAmount;
    private BigDecimal totalPremium;

    // =========================================================
    // PAYMENT STATUS AND RAZORPAY REFERENCES
    // =========================================================

    private String paymentStatus;
    private String transactionId;
    private String razorpayOrderId;
    private String razorpayPaymentId;
    private String razorpaySignature;

    // =========================================================
    // PAYMENT AND PURCHASE DATES
    // =========================================================

    private LocalDate paymentDate;
    private LocalDateTime paymentDateTime;
    private LocalDate purchaseDate;
    private LocalDateTime createdAt;

    // =========================================================
    // REFUND DETAILS
    // =========================================================

    private String refundStatus;
    private String refundId;
    private BigDecimal refundAmount;
    private String refundReason;
    private LocalDateTime refundDateTime;

    // =========================================================
    // REFUND ELIGIBILITY
    // =========================================================

    private LocalDateTime refundDeadline;
    private Boolean refundEligible;
}
