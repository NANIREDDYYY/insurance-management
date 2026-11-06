
package com.htc.insurance.dto;

public record VehicleVerificationResponse(
        String status,
        String registrationNumber,
        String ownerName,
        String vehicle,
        String fuel,
        Boolean insuranceValid,
        String state,
        String rto
) {
}
