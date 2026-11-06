
package com.htc.insurance.exceptionhandler;

import java.util.HashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.AuthenticationException;

import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

import com.htc.insurance.exception.ResourceNotFoundException;

@RestControllerAdvice
public class MyAppExceptionHandler {

    private static final Logger log =
            LoggerFactory.getLogger(MyAppExceptionHandler.class);

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, String>> handleValidation(
            MethodArgumentNotValidException ex) {

        Map<String, String> errors = new HashMap<>();

        ex.getBindingResult()
                .getFieldErrors()
                .forEach(error ->
                        errors.putIfAbsent(
                                error.getField(),
                                error.getDefaultMessage() != null
                                        ? error.getDefaultMessage()
                                        : "Invalid value"
                        )
                );

        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(errors);
    }

    @ExceptionHandler(BadCredentialsException.class)
    public ResponseEntity<Map<String, Object>> handleBadCredentials(
            BadCredentialsException ex) {

        return errorResponse(
                HttpStatus.UNAUTHORIZED,
                "Invalid username or password"
        );
    }

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<Map<String, Object>> handleAuthenticationException(
            AuthenticationException ex) {

        return errorResponse(
                HttpStatus.UNAUTHORIZED,
                "Invalid username or password"
        );
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<Map<String, String>> handleAccessDenied(
            AccessDeniedException ex) {

        Map<String, String> error = new HashMap<>();
        error.put("error", "Access Denied");

        return ResponseEntity
                .status(HttpStatus.FORBIDDEN)
                .body(error);
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<Map<String, String>> handleResourceNotFound(
            ResourceNotFoundException ex) {

        Map<String, String> error = new HashMap<>();

        error.put(
                "error",
                ex.getMessage() != null
                        ? ex.getMessage()
                        : "Resource not found"
        );

        return ResponseEntity
                .status(HttpStatus.NOT_FOUND)
                .body(error);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> handleIllegalArgument(
            IllegalArgumentException ex) {

        return errorResponse(
                HttpStatus.BAD_REQUEST,
                ex.getMessage() != null && !ex.getMessage().isBlank()
                        ? ex.getMessage()
                        : "Invalid request"
        );
    }

    // Handles errors deliberately raised by services.
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> handleResponseStatus(
            ResponseStatusException ex) {

        HttpStatus status = HttpStatus.resolve(
                ex.getStatusCode().value()
        );

        if (status == null) {
            status = HttpStatus.INTERNAL_SERVER_ERROR;
        }

        String message = ex.getReason() != null
                ? ex.getReason()
                : "Request could not be completed";

        return errorResponse(status, message);
    }

    // Handles unexpected application errors.
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGeneralException(
            Exception ex) {

        log.error(
                "Unhandled application exception: {}",
                ex.getClass().getName(),
                ex
        );

        return errorResponse(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "An unexpected error occurred"
        );
    }

    private ResponseEntity<Map<String, Object>> errorResponse(
            HttpStatus status,
            String message) {

        Map<String, Object> response = new HashMap<>();

        response.put("success", false);
        response.put("message", message);

        return ResponseEntity
                .status(status)
                .body(response);
    }
}
