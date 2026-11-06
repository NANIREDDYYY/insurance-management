
package com.htc.insurance.entity;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(
    name = "policy_purchase",
    uniqueConstraints = {
        @UniqueConstraint(
            name = "uk_policy_purchase_renewed_from",
            columnNames = "renewed_from_purchase_id"
        )
    }
)
@Getter
@Setter
@NoArgsConstructor
public class PolicyPurchase {

    // =========================================================
    // PRIMARY KEY
    // =========================================================

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long purchaseId;

    // =========================================================
    // POLICY - ONE PURCHASE PER POLICY
    // =========================================================

    @OneToOne
    @JoinColumn(
        name = "policy_number",
        nullable = false,
        unique = true
    )
    private Policy policy;

    // =========================================================
    // POLICY RENEWAL
    // =========================================================

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(
        name = "renewed_from_purchase_id",
        referencedColumnName = "purchaseId"
    )
    private PolicyPurchase renewedFromPurchase;

    // =========================================================
    // ORIGINAL INSURANCE PLAN
    // =========================================================

    @Column(name = "plan_id")
    private Long planId;

    // =========================================================
    // COVERAGE
    // =========================================================

    @Column(precision = 15, scale = 2)
    private BigDecimal coverageAmount;

    // =========================================================
    // PREMIUM BREAKDOWN
    // =========================================================

    @Column(precision = 15, scale = 2)
    private BigDecimal basePremium;

    @Column(precision = 15, scale = 2)
    private BigDecimal discountAmount;

    @Column(precision = 15, scale = 2)
    private BigDecimal taxableAmount;

    @Column(precision = 5, scale = 2)
    private BigDecimal gstRate;

    @Column(precision = 15, scale = 2)
    private BigDecimal gstAmount;

    @Column(precision = 15, scale = 2)
    private BigDecimal totalPremium;

    // =========================================================
    // NOMINEE INFORMATION
    // =========================================================

    private String nomineeName;

    private String nomineeRelation;

    private String nomineeContact;

    // =========================================================
    // INSURANCE APPLICATION DETAILS
    //
    // Supports:
    // HEALTH       - medical and applicant information
    // FAMILY       - primary applicant information
    // VEHICLE      - registration and vehicle information
    // LIFE         - applicant and beneficiary information
    // OTHER        - additional plan-specific information
    //
    // Stored as MySQL JSON.
    // =========================================================

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(
        name = "application_details",
        columnDefinition = "json"
    )
    private Map<String, Object> applicationDetails;

    // =========================================================
    // FAMILY MEMBERS
    //
    // Stores multiple family members independently.
    // Each entry can contain name, relation, DOB,
    // gender, occupation and other relevant details.
    // =========================================================

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(
        name = "family_members",
        columnDefinition = "json"
    )
    private List<Map<String, Object>> familyMembers;

    // =========================================================
    // PAYMENT INFORMATION
    // =========================================================

    private String paymentMethod;

    private String paymentStatus;

    // =========================================================
    // RAZORPAY REFERENCES
    // =========================================================

    @Column(unique = true)
    private String transactionId;

    @Column(unique = true)
    private String razorpayOrderId;

    @Column(unique = true)
    private String razorpayPaymentId;

    // =========================================================
    // PAYMENT DATE AND TIME
    // =========================================================

    private LocalDate paymentDate;

    private LocalDateTime paymentDateTime;

    // =========================================================
    // PURCHASE DATE AND TIME
    // =========================================================

    private LocalDate purchaseDate;

    private LocalDateTime createdAt;

    // =========================================================
    // REFUND INFORMATION
    // =========================================================

    @Column(length = 50)
    private String refundStatus;

    private String refundId;

    @Column(precision = 15, scale = 2)
    private BigDecimal refundAmount;

    @Column(length = 500)
    private String refundReason;

    private LocalDateTime refundDateTime;
}
