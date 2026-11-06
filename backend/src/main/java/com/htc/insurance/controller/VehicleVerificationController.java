
package com.htc.insurance.controller;

import jakarta.validation.Valid;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import com.htc.insurance.dto.VehicleVerificationRequest;
import com.htc.insurance.dto.VehicleVerificationResponse;
import com.htc.insurance.service.VehicleVerificationService;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/vehicles")
@RequiredArgsConstructor
public class VehicleVerificationController {

    private final VehicleVerificationService vehicleVerificationService;

    @PostMapping("/verify")
    public ResponseEntity<VehicleVerificationResponse> verifyVehicle(
            @Valid @RequestBody VehicleVerificationRequest request) {

        VehicleVerificationResponse response =
                vehicleVerificationService.verify(
                        request.registrationNumber()
                );

        return ResponseEntity.ok(response);
    }
}

