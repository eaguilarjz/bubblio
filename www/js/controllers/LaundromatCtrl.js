angular.module('starter').controller('LaundromatCtrl', function($scope, $state, $ionicHistory, $stateParams, $ionicModal, Orders
                                                                 Laundromats, Rating, Reviews, Datetime, Customers, Addresses) {
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
    $scope.address_id = 0;
    
    // TODO: Change this constant value for a function that returns the current user_id
    $scope.user_id = 5;
    
    // Calculate the fair
    $scope.calculateFare= function(qty) {
        var invoicedQuantity = qty;
        
        if ($scope.laundromat.whole_flag === 'Y') {
            invoicedQuantity = Math.ceil(qty / $scope.laundromat.ium_factor) * $scope.laundromat.ium_factor;
        };
        
        return invoicedQuantity * $scope.laundromat.quotation_price;
    };
    
    // Retrieve the customer details
    Customers.get({user_id: $scope.user_id}, function(data) {
        $scope.customer = data.customers[0];
    });
    
    // Retrieve the address
    Addresses.get({user_id: $scope.user_id}, function(data) {
        $scope.addresses = data.addresses;
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
        Orders.save({
            customer_id: ,
            address_id: ,
            requested_pickup: ,
            requested_delivery: ,
            site_id: ,
            service_id: ,
            requested_quantity: ,
            requested_uom_code: ,
            requested_unit_price: 
        });
        
        $scope.orderModal.hide();
        $ionicHistory.nextViewOptions({
            disableBack: true
        });
        $state.go('app.confirmation');
    };
});
