
package com.htc.insurance.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record VehicleVerificationRequest(

        @NotBlank(message = "Vehicle registration number is required")
        @Size(min = 6, max = 15,
              message = "Invalid vehicle registration number length")
        String registrationNumber

) {
}
