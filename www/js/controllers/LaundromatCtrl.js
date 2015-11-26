angular.module('starter').controller('LaundromatCtrl', function($scope, $state, $ionicHistory, $stateParams, $ionicModal, $rootScope, $http, $window, $cordovaInAppBrowser, Orders, Laundromats, Rating, Reviews, Datetime, Customers, Addresses, CurrentUser) {
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
    $scope.address_id = $stateParams.addressId;
    
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
    Addresses.get({user_id: $scope.user_id, address_id: $scope.address_id}, function(data) {
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
       
        var basicAuthString = 	
	btoa('AVPYiriMnFyIB83gr855qNIzmlgXME9_JI4Rkk2eY84ahjFTAWe4lgSPWF4Atd3i4X7nJ62awHTtHmIL:EC2QhrYKr2Ux5wEbF3DzD8a3zEZQOYiO1apY5nlIe9FEsH1GvR3lMd3dm1TAiHfkJUYhJWDCxuZesBHf');
	
		$http({
	        url: 'https://api-3t.sandbox.paypal.com/nvp',
	        method: 'GET',
	   	    params: {
		   	    'USER': 'norencet-facilitator_api1.gmail.com',
		   	    'PWD': 'D8UV67ZPSZ7FTSZ4',
		   	    'SIGNATURE': 'AZ0lUt4aW8haNRizJJIUKtB-G9qRAw4s9Cj7Ho4kkGmiuDlZShG770ws',
		   	    'METHOD': 'SetExpressCheckout',
		   	    'VERSION': "78",
		   	    'PAYMENTREQUEST_0_PAYMENTACTION': 'SALE',
		   	    'PAYMENTREQUEST_0_AMT': $scope.laundromat.invoice_price,
		   	    'PAYMENTREQUEST_0_CURRENCYCODE': 'USD',
		   	    'cancelUrl': 'http://localhost:8100/#/app/dashboard',
		   	    'returnUrl': 'mobile/close'
		   	     }
		}).success(function (data, status, headers, config) {
			var token = data.split("&")[0].split("=")[1];
			
			var options = { location: 'yes', clearcache: 'yes', toolbar: 'no' };
			$cordovaInAppBrowser.open("https://www.sandbox.paypal.com/webscr?cmd=_express-checkout&useraction=commit&token=" + token, '_blank', options)
		      .then(function(event) {
		        // success
		      })
		      .catch(function(event) {
		        // error
		      });
		      
		      $rootScope.$on('$cordovaInAppBrowser:loadstop', function(e, event) {
			      
		      });
    		
			
		
		}).error(function (data, status, headers, config) {
			console.log(data)
		});
           
    });
    };
});
