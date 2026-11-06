
package com.htc.insurance.controller;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import com.htc.insurance.dto.PurchasePolicyDto;
import com.htc.insurance.dto.RefundRequestDto;
import com.htc.insurance.service.PolicyPurchaseService;
import com.htc.insurance.service.RazorpayRefundService;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/policy")
@RequiredArgsConstructor
public class PolicyPurchaseController {

    private final PolicyPurchaseService policyPurchaseService;
    private final RazorpayRefundService razorpayRefundService;

    // =========================================================
    // USER - PURCHASE INSURANCE POLICY
    // =========================================================

    @PostMapping("/purchase")
    @PreAuthorize("hasRole('USER')")
    public ResponseEntity<PurchasePolicyDto> purchasePolicy(
            @Valid @RequestBody PurchasePolicyDto purchaseDto,
            Authentication authentication) {

        if (purchaseDto == null) {
            throw new IllegalArgumentException(
                    "Purchase details are required.");
        }

        requireAuthentication(authentication);

        return ResponseEntity.status(HttpStatus.CREATED).body(
                policyPurchaseService.purchasePolicy(
                        purchaseDto,
                        authentication
                )
        );
    }

    // =========================================================
    // ADMIN - GET ALL PURCHASES
    // =========================================================

    @GetMapping("/purchases")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<List<PurchasePolicyDto>> getAllPurchases() {

        return ResponseEntity.ok(
                policyPurchaseService.getAllPurchases()
        );
    }

    // =========================================================
    // USER - GET MY PURCHASES
    // =========================================================

    @GetMapping("/my-purchases")
    @PreAuthorize("hasRole('USER')")
    public ResponseEntity<List<PurchasePolicyDto>> getMyPurchases(
            Authentication authentication) {

        requireAuthentication(authentication);

        return ResponseEntity.ok(
                policyPurchaseService.getMyPurchases(authentication)
        );
    }

    // =========================================================
    // USER - REQUEST FULL REFUND
    // =========================================================

    @PostMapping("/purchases/{purchaseId}/refund")
    @PreAuthorize("hasRole('USER')")
    public ResponseEntity<PurchasePolicyDto> requestRefund(
            @PathVariable Long purchaseId,
            @Valid @RequestBody RefundRequestDto request,
            Authentication authentication) throws Exception {

        if (purchaseId == null || purchaseId <= 0) {
            throw new IllegalArgumentException(
                    "A valid purchase ID is required.");
        }

        requireAuthentication(authentication);

        if (authentication.getName() == null
                || authentication.getName().isBlank()) {
            throw new AccessDeniedException(
                    "Authentication is required.");
        }

        if (request == null
                || request.getRefundReason() == null
                || request.getRefundReason().isBlank()) {

            throw new IllegalArgumentException(
                    "Refund reason is required.");
        }

        // Service validates ownership, payment status,
        // refund eligibility and duplicate refund protection.
        razorpayRefundService.requestFullRefund(
                purchaseId,
                authentication.getName(),
                request.getRefundReason().trim()
        );

        // Preserve the existing purchase DTO response.
        return policyPurchaseService
                .getMyPurchases(authentication)
                .stream()
                .filter(p -> purchaseId.equals(p.getPurchaseId()))
                .findFirst()
                .map(ResponseEntity::ok)
                .orElseThrow(() -> new IllegalStateException(
                        "Refund was processed, but the purchase response "
                        + "could not be loaded."
                ));
    }

    // =========================================================
    // AUTHENTICATION HELPER
    // =========================================================

    private void requireAuthentication(
            Authentication authentication) {

        if (authentication == null
                || !authentication.isAuthenticated()) {

            throw new AccessDeniedException(
                    "Authentication is required.");
        }
    }
}
