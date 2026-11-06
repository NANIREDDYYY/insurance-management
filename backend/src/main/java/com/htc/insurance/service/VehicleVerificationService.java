
package com.htc.insurance.service;

import java.util.Map;
import java.util.regex.Pattern;

import com.fasterxml.jackson.databind.JsonNode;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

    private static final Logger log =
            LoggerFactory.getLogger(VehicleVerificationService.class);

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
            log.error("API Express configuration is missing: API key not configured");

            throw new ResponseStatusException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "Vehicle verification is not configured"
            );
        }

        try {

            log.info("Starting vehicle verification for registration: {}", rcNumber);

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

            if (response == null) {
                log.error("API Express returned an empty response");

                throw new ResponseStatusException(
                        HttpStatus.BAD_GATEWAY,
                        "Vehicle verification provider returned an empty response"
                );
            }

            String providerStatus = response.path("status").asText();

            if (!"success".equalsIgnoreCase(providerStatus)) {
                log.warn(
                        "Vehicle verification unsuccessful for registration: {}",
                        rcNumber
                );

                throw new ResponseStatusException(
                        HttpStatus.UNPROCESSABLE_ENTITY,
                        "The vehicle could not be verified. Check the registration number."
                );
            }

            VehicleVerificationResponse result =
                    new VehicleVerificationResponse(
                            "success",
                            rcNumber,
                            textOrNull(response, "owner_name"),
                            textOrNull(response, "vehicle"),
                            textOrNull(response, "fuel"),
                            booleanOrNull(response, "insurance_valid"),
                            textOrNull(response, "state"),
                            textOrNull(response, "rto")
                    );

            log.info("Vehicle verification completed for registration: {}", rcNumber);

            return result;

        } catch (RestClientResponseException exception) {

            log.error(
                    "API Express HTTP error. Provider HTTP status: {}",
                    exception.getStatusCode()
            );

            throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY,
                    "Vehicle verification provider returned an error"
            );

        } catch (ResourceAccessException exception) {

            // Print the complete exception and underlying cause.
            // Authorization headers and API keys are not logged.
            log.error(
                    "API Express connection failed. Full exception details:",
                    exception
            );

            Throwable cause = exception.getMostSpecificCause();

            log.error(
                    "API Express root cause: {} - {}",
                    cause.getClass().getName(),
                    cause.getMessage()
            );

            throw new ResponseStatusException(
                    HttpStatus.GATEWAY_TIMEOUT,
                    "Vehicle verification service timed out. Please try again."
            );

        } catch (ResponseStatusException exception) {

            throw exception;

        } catch (Exception exception) {

            log.error(
                    "Unexpected vehicle verification error. Exception type: {}",
                    exception.getClass().getName(),
                    exception
            );

            throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY,
                    "Unable to verify vehicle details currently. Please try again."
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

    
private void diagnoseApiExpressDns() {
    try {
        java.net.InetAddress[] addresses =
                java.net.InetAddress.getAllByName("api.apiexpress.in");

        for (java.net.InetAddress address : addresses) {
            log.info("API Express DNS resolved to: {}", address.getHostAddress());
        }

    } catch (Exception exception) {
        log.error("API Express DNS resolution failed", exception);
    }
}

}


