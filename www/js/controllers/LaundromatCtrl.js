angular.module('starter').controller('LaundromatCtrl', function($scope, $state, $ionicHistory, $stateParams, $ionicModal, // $http, $window, 
                                                                 Orders, Laundromats, Rating, Reviews, Datetime, Customers, Addresses, CurrentUser) {
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
    $scope.user_id = CurrentUser.getUserId();
    
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
        
        Orders.save(orderData, function(data) {
            $scope.orderModal.hide();
            $ionicHistory.nextViewOptions({
                disableBack: true
            });
            $state.go('app.confirmation');
        });
    };
});
