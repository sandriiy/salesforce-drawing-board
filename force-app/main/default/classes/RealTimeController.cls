public with sharing class RealTimeController {
    @AuraEnabled(cacheable=true)
    public static String getInitialCanvasState() {
        RealTimeDrawConfig__mdt config = RealTimeDrawConfig__mdt.getInstance('Default');

        if (config != null && String.isNotBlank(config.InitialState__c)) {
            return config.InitialState__c;
        }

        return null;
    }

    @AuraEnabled(cacheable=false)
    public static String getSessionDetails() {
        String sessionId = UserInfo.getSessionId();

        if (String.isBlank(sessionId)) {
            return getTokenForUser();
        } else {
            return sessionId;
        }
    }

    @AuraEnabled
    public static void publishRealTimeDrawEvent(String compressedState, String localSessionId) {
        EventBus.publish(
            new RealTimeDraw__e(
                State__c = compressedState,
                LocalSessionId__c = localSessionId
            )
        );
    }

    private static String getTokenForUser() {
        String loginUrl = 'https://login.salesforce.com';
        String body = ''; // ...

        HttpRequest req = new HttpRequest();
        req.setEndpoint(loginUrl + '/services/oauth2/token');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
        req.setBody(body);

        Http http = new Http();
        HttpResponse res = http.send(req);

        if (res.getStatusCode() == 200) {
            Map<String, Object> tokenMap = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
            return (String) tokenMap.get('access_token');
        } else {
            throw new AuraHandledException('Failed to retrieve access token');
        }
    }
}