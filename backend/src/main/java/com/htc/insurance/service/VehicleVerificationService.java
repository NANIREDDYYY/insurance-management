
package com.htc.insurance.service;

import java.util.Map;
import java.util.regex.Pattern;

import com.fasterxml.jackson.databind.JsonNode;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;

import com.htc.insurance.dto.VehicleVerificationResponse;

@Service
public class VehicleVerificationService {

    private static final Pattern RC_PATTERN =
            Pattern.compile("^[A-Z0-9]{6,15}$");

    private final RestClient restClient;
    private final String apiKey;

    public VehicleVerificationService(
            RestClient apiExpressRestClient,
            @Value("${apiexpress.api-key:}") String apiKey) {

        this.restClient = apiExpressRestClient;
        this.apiKey = apiKey;
    }

    public VehicleVerificationResponse verify(String registrationNumber) {

        String rcNumber = normalizeRegistrationNumber(registrationNumber);

        if (!RC_PATTERN.matcher(rcNumber).matches()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Please enter a valid vehicle registration number"
            );
        }

        if (apiKey == null || apiKey.isBlank()) {
            throw new ResponseStatusException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "Vehicle verification is not configured"
            );
        }

        try {

            JsonNode response = restClient.post()
                    .uri("/v1/rc/verify")
                    .header(
                            HttpHeaders.AUTHORIZATION,
                            "Bearer " + apiKey
                    )
                    .contentType(MediaType.APPLICATION_JSON)
                    .accept(MediaType.APPLICATION_JSON)
                    .body(Map.of("rc_number", rcNumber))
                    .retrieve()
                    .body(JsonNode.class);

            if (response == null
                    || !"success".equalsIgnoreCase(
                            response.path("status").asText())) {

                throw new ResponseStatusException(
                        HttpStatus.UNPROCESSABLE_ENTITY,
                        "The vehicle could not be verified. Check the registration number."
                );
            }

            return new VehicleVerificationResponse(
                    "success",
                    rcNumber,
                    textOrNull(response, "owner_name"),
                    textOrNull(response, "vehicle"),
                    textOrNull(response, "fuel"),
                    booleanOrNull(response, "insurance_valid"),
                    textOrNull(response, "state"),
                    textOrNull(response, "rto")
            );

        } catch (RestClientResponseException exception) {

            // Do not return the provider response or API key to the customer.
            throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY,
                    "Vehicle verification provider returned an error"
            );

        } catch (ResourceAccessException exception) {

            throw new ResponseStatusException(
                    HttpStatus.GATEWAY_TIMEOUT,
                    "Vehicle verification service timed out. Please try again."
            );

        }
    }

    private String normalizeRegistrationNumber(String value) {

        if (value == null) {
            return "";
        }

        return value
                .trim()
                .toUpperCase()
                .replaceAll("[\\s-]", "");
    }

    private String textOrNull(JsonNode response, String field) {

        JsonNode value = response.get(field);

        if (value == null || value.isNull()) {
            return null;
        }

        String text = value.asText().trim();

        return text.isEmpty() ? null : text;
    }

    private Boolean booleanOrNull(JsonNode response, String field) {

        JsonNode value = response.get(field);

        if (value == null || value.isNull()
                || !value.isBoolean()) {
            return null;
        }

        return value.booleanValue();
    }
}
