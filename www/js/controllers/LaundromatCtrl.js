angular.module('starter').controller('LaundromatCtrl', function($scope, $state, $ionicHistory, $stateParams, $ionicModal, // $http, $window, 
                                                                 Orders, Laundromats, Rating, Reviews, Datetime, Customers, Addresses) {
    // Get the laundromat list
    Laundromats.get({
        site_id: $stateParams.siteId,
        service_id: $stateParams.serviceId
    }, function(data) {
        $scope.laundromat = data.laundromats[0];
        // Add ratings
        $scope.laundromat.stars = Rating.getImages($scope.laundromat.avg_score);
    });
    
    // Get the reviews list
    Reviews.get({
        site_id: $stateParams.siteId
    }, function(data) {
        $scope.reviews = data.reviews;
        // Add ratings
        for (var i=0; i<$scope.reviews.length; i++) {
            $scope.reviews[i].stars = Rating.getImages($scope.reviews[i].score);
        }
    })

    $scope.serviceId = $stateParams.serviceId;
    $scope.pickupDate = Datetime.toDate($stateParams.pickupDate);
    $scope.deliveryDate = Datetime.toDate($stateParams.deliveryDate);
    $scope.quantity = 0;
    
    // TODO: Change this constant value for a function that returns the current user_id
    $scope.user_id = 5;
    
    // Calculate the fair
    $scope.calculateFare= function(qty) {
        var invoicedQuantity = qty;
        
        if ($scope.laundromat.whole_flag === 'Y') {
            invoicedQuantity = Math.ceil(qty / $scope.laundromat.ium_factor) * $scope.laundromat.ium_factor;
        };
        
        $scope.invoicedQuantity = invoicedQuantity / $scope.laundromat.ium_factor;
        
        return invoicedQuantity * $scope.laundromat.quotation_price;
    };
    
    // Retrieve the customer details
    Customers.get({user_id: $scope.user_id}, function(data) {
        $scope.customer = data.customers[0];
    });
    
    // Retrieve the address
    Addresses.get({user_id: $scope.user_id}, function(data) {
        $scope.addresses = data.addresses;
        $scope.address_id = data.addresses[0].address_id;
    });
    
    // Create and load the Modal
    $ionicModal.fromTemplateUrl('new-order.html', function(modal) {
        $scope.orderModal = modal;
    }, {
        scope: $scope,
        animation: 'slide-in-up'
    });
    
    // Open our new task modal
    $scope.newOrder = function(qty) {
        $scope.requestedQuantity = qty;
        $scope.orderModal.show();
    };
    
    // Close our new task modal
    $scope.closeNewOrder = function() {
        $scope.orderModal.hide();
    };
    
    // Place a new order
    $scope.placeNewOrder = function() {
        // TODO: Add a new order to the database
        var result = false;
        var orderData = {
            customer_id: $scope.customer.customer_id,
            address_id: $scope.address_id,
            requested_pickup: Datetime.toDate($stateParams.pickupDate),
            requested_delivery: Datetime.toDate($stateParams.deliveryDate),
            site_id: $stateParams.siteId,
            service_id: $scope.serviceId,
            requested_quantity: $scope.requestedQuantity,
            requested_uom_code: $scope.laundromat.quotation_uid,
            requested_unit_price: $scope.laundromat.quotation_price,
            actual_quantity: $scope.invoicedQuantity,
            actual_uom_code: $scope.laundromat.invoice_uid,
            actual_unit_price: $scope.laundromat.invoice_price
        };
        $scope.testData = orderData;
        
        Orders.save(orderData, function(data) {
            result = data;
        });
        
        if (result == 'false') {
            $scope.orderModal.hide();
            $ionicHistory.nextViewOptions({
                disableBack: true
            });
            $state.go('app.confirmation');
        }
        
    };
        
        /*
        var clientToken = "eyJ2ZXJzaW9uIjoyLCJhdXRob3JpemF0aW9uRmluZ2VycHJpbnQiOiI0NDE0MWZhYzI5ODE0YTlmZDY2ZWE5NTk3MzgxMDcwZmI3MWQ4MzM0MGJkNDMzMWI0ZDU0ZmU5OGRiYTBkYzI1fGNyZWF0ZWRfYXQ9MjAxNS0xMC0yOFQyMDo1Nzo0MC44ODgxOTkyOTErMDAwMFx1MDAyNm1lcmNoYW50X2lkPTM0OHBrOWNnZjNiZ3l3MmJcdTAwMjZwdWJsaWNfa2V5PTJuMjQ3ZHY4OWJxOXZtcHIiLCJjb25maWdVcmwiOiJodHRwczovL2FwaS5zYW5kYm94LmJyYWludHJlZWdhdGV3YXkuY29tOjQ0My9tZXJjaGFudHMvMzQ4cGs5Y2dmM2JneXcyYi9jbGllbnRfYXBpL3YxL2NvbmZpZ3VyYXRpb24iLCJjaGFsbGVuZ2VzIjpbXSwiZW52aXJvbm1lbnQiOiJzYW5kYm94IiwiY2xpZW50QXBpVXJsIjoiaHR0cHM6Ly9hcGkuc2FuZGJveC5icmFpbnRyZWVnYXRld2F5LmNvbTo0NDMvbWVyY2hhbnRzLzM0OHBrOWNnZjNiZ3l3MmIvY2xpZW50X2FwaSIsImFzc2V0c1VybCI6Imh0dHBzOi8vYXNzZXRzLmJyYWludHJlZWdhdGV3YXkuY29tIiwiYXV0aFVybCI6Imh0dHBzOi8vYXV0aC52ZW5tby5zYW5kYm94LmJyYWludHJlZWdhdGV3YXkuY29tIiwiYW5hbHl0aWNzIjp7InVybCI6Imh0dHBzOi8vY2xpZW50LWFuYWx5dGljcy5zYW5kYm94LmJyYWludHJlZWdhdGV3YXkuY29tIn0sInRocmVlRFNlY3VyZUVuYWJsZWQiOnRydWUsInRocmVlRFNlY3VyZSI6eyJsb29rdXBVcmwiOiJodHRwczovL2FwaS5zYW5kYm94LmJyYWludHJlZWdhdGV3YXkuY29tOjQ0My9tZXJjaGFudHMvMzQ4cGs5Y2dmM2JneXcyYi90aHJlZV9kX3NlY3VyZS9sb29rdXAifSwicGF5cGFsRW5hYmxlZCI6dHJ1ZSwicGF5cGFsIjp7ImRpc3BsYXlOYW1lIjoiQWNtZSBXaWRnZXRzLCBMdGQuIChTYW5kYm94KSIsImNsaWVudElkIjpudWxsLCJwcml2YWN5VXJsIjoiaHR0cDovL2V4YW1wbGUuY29tL3BwIiwidXNlckFncmVlbWVudFVybCI6Imh0dHA6Ly9leGFtcGxlLmNvbS90b3MiLCJiYXNlVXJsIjoiaHR0cHM6Ly9hc3NldHMuYnJhaW50cmVlZ2F0ZXdheS5jb20iLCJhc3NldHNVcmwiOiJodHRwczovL2NoZWNrb3V0LnBheXBhbC5jb20iLCJkaXJlY3RCYXNlVXJsIjpudWxsLCJhbGxvd0h0dHAiOnRydWUsImVudmlyb25tZW50Tm9OZXR3b3JrIjp0cnVlLCJlbnZpcm9ubWVudCI6Im9mZmxpbmUiLCJ1bnZldHRlZE1lcmNoYW50IjpmYWxzZSwiYnJhaW50cmVlQ2xpZW50SWQiOiJtYXN0ZXJjbGllbnQzIiwiYmlsbGluZ0FncmVlbWVudHNFbmFibGVkIjp0cnVlLCJtZXJjaGFudEFjY291bnRJZCI6ImFjbWV3aWRnZXRzbHRkc2FuZGJveCIsImN1cnJlbmN5SXNvQ29kZSI6IlVTRCJ9LCJjb2luYmFzZUVuYWJsZWQiOmZhbHNlLCJtZXJjaGFudElkIjoiMzQ4cGs5Y2dmM2JneXcyYiIsInZlbm1vIjoib2ZmIn0=";

braintree.setup(clientToken, "dropin", {
  container: "payment-form"
});
*/

        //$window.location.href = "http://www.google.com";		        


});
