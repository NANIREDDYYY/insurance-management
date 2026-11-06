
package com.htc.insurance.config;

import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

@Configuration
public class ApiExpressConfig {

    private static final Logger log =
            LoggerFactory.getLogger(ApiExpressConfig.class);

    @Bean("apiExpressRestClient")
    public RestClient apiExpressRestClient(
            @Value("${apiexpress.base-url:https://api.apiexpress.in}")
            String baseUrl,

            @Value("${apiexpress.connect-timeout-ms:10000}")
            long connectTimeout,

            @Value("${apiexpress.read-timeout-ms:20000}")
            long readTimeout) {

        // Diagnose the actual configured hostname.
        try {
            String host = URI.create(baseUrl.trim()).getHost();

            if (host == null || host.isBlank()) {
                log.error("API Express base URL has an invalid hostname");
            } else {
                log.info("API Express configured hostname: {}", host);

                InetAddress[] addresses =
                        InetAddress.getAllByName(host);

                for (InetAddress address : addresses) {
                    log.info(
                            "API Express resolved IP: {}",
                            address.getHostAddress()
                    );
                }
            }

        } catch (Exception exception) {
            log.error(
                    "API Express startup DNS diagnostic failed",
                    exception
            );
        }

        log.info("API Express connect timeout: {} ms", connectTimeout);
        log.info("API Express read timeout: {} ms", readTimeout);

        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(connectTimeout))
                .build();

        JdkClientHttpRequestFactory requestFactory =
                new JdkClientHttpRequestFactory(httpClient);

        requestFactory.setReadTimeout(
                Duration.ofMillis(readTimeout)
        );

        return RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(requestFactory)
                .build();
    }
}
