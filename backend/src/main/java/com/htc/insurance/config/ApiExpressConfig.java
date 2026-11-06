
package com.htc.insurance.config;

import java.net.http.HttpClient;
import java.time.Duration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

@Configuration
public class ApiExpressConfig {

    @Bean("apiExpressRestClient")
    public RestClient apiExpressRestClient(
            @Value("${apiexpress.base-url:https://api.apiexpress.in}")
            String baseUrl,

            @Value("${apiexpress.connect-timeout-ms:10000}")
            long connectTimeout,

            @Value("${apiexpress.read-timeout-ms:20000}")
            long readTimeout) {

        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(connectTimeout))
                .build();

        JdkClientHttpRequestFactory requestFactory =
                new JdkClientHttpRequestFactory(httpClient);

        requestFactory.setReadTimeout(Duration.ofMillis(readTimeout));

        return RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(requestFactory)
                .build();
    }
}
