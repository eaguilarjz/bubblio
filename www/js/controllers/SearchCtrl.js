angular.module('starter').controller('SearchCtrl', function($scope, $stateParams, $ionicPopup, $state, $filter, Geolocation, Services, CurrentUser, Addresses, DialogBox, Laundromats) {
   
    // Initial location
    $scope.currentLocation = {
        latitude: 0,
        longitude: 0
    };
    $scope.user_id = CurrentUser.getUserId();
    
    // Retrieve the address
    Addresses.get({user_id: $scope.user_id}, function(data) {
        $scope.addresses = data.addresses;
        if (data.addresses.length == 0) {
            DialogBox.showDialog('alert', 'Address', 'Before we proceed, you need to add an address.');
            Geolocation.get().then(function(loc) {
                $scope.currentLocation = loc;
                $state.go('app.address', {userId: $scope.user_id, latitude: $scope.currentLocation.latitude, longitude: $scope.currentLocation.longitude})    
            });
        }
        $scope.addressId = data.addresses[0].address_id;
        $scope.currentLocation.latitude = data.addresses[0].latitude;
        $scope.currentLocation.longitude = data.addresses[0].longitude;
    }, function(error) {
        if (typeof $scope.user_id == 'undefined') {
            DialogBox.showDialog('alert', 'Address', 'Before we proceed, you need to add an address.');
            Geolocation.get().then(function(loc) {
                $scope.currentLocation = loc;
                $state.go('app.address', {userId: $scope.user_id, latitude: $scope.currentLocation.latitude, longitude: $scope.currentLocation.longitude})    
            });
        }
    });
    
    
    $scope.currentDate = new Date();
    
    // Get the service list
    Services.get({}, function(res) {
        for (var i=0; i< res.services.length; i++) {
            if (res.services[i].service_id == $stateParams.serviceId) {
                $scope.services = [res.services[i]];
            }
        }
    });
        
    // Function to change the latitude and longitude, based on the selected address
    $scope.updateLocation = function(adr) {
        if (!isNaN(adr)) {
            for (var i=0; i<$scope.addresses.length; i++) {
                if ($scope.addresses[i].address_id == adr) {
                    $scope.addressId = adr;
                    $scope.currentLocation.latitude = $scope.addresses[i].latitude;
                    $scope.currentLocation.longitude = $scope.addresses[i].longitude;
                    break;
                }
            }
        }
    };
    
    // Get default date
    var getDateTime = function(hourOfDay) {
        var currentDate = new Date();
        var proposedDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1, hourOfDay, 0)
        console.log(proposedDate);
        return proposedDate;
    };
    
    $scope.searchParams = {
        service: $stateParams.serviceId,
        pickupDate: getDateTime(8),
        deliveryDate: getDateTime(17)
    };
    
    $scope.search = function(isValid) {
        Laundromats.get({
           service_id: $scope.searchParams.service,
           latitude: $scope.currentLocation.latitude,
           longitude: $scope.currentLocation.longitude,
           pickup_date: $filter('date')($scope.searchParams.pickupDate, 'yyyyMMddHHmmss'),
           delivery_date: $filter('date')($scope.searchParams.deliveryDate, 'yyyyMMddHHmmss'),
        }, function(data) {
            // Redirects to the search screen if no laundromats are found
            if (data.laundromats.length == 0) {
                DialogBox.showDialog('alert', 'No laundromats found', 'Sorry, we couldn\'t found any laundromats nearby for these parameters.');
            } else {
                $state.go('app.laundromats', {
                   serviceId: $scope.searchParams.service,
                   latitude: $scope.currentLocation.latitude,
                   longitude: $scope.currentLocation.longitude,
                   pickupDate: $filter('date')($scope.searchParams.pickupDate, 'yyyyMMddHHmmss'),
                   deliveryDate: $filter('date')($scope.searchParams.deliveryDate, 'yyyyMMddHHmmss'),
                   addressId: $scope.addressId,
                });                
            }
        });

    }
    
    /*
    $scope.timePickerObject = {
	  inputEpochTime: ((new Date()).getHours() * 60 * 60),  //Optional
	  step: 15,  //Optional
	  format: 12,  //Optional
	  titleLabel: '12-hour Format',  //Optional
	  setLabel: 'Set',  //Optional
	  closeLabel: 'Close',  //Optional
	  setButtonType: 'button-positive',  //Optional
	  closeButtonType: 'button-stable',  //Optional
	  callback: function (val) {    //Mandatory
	    timePickerCallback(val);
	  }
	};
    
	function timePickerCallback(val) {
	  if (typeof (val) === 'undefined') {
	    console.log('Time not selected');
	  } else {
	  var selectedTime = new Date(val * 1000);
	  console.log('Selected epoch is : ', val, 'and the time is ', selectedTime.getUTCHours(), ':', selectedTime.getUTCMinutes(), 'in UTC');
      }
    }
    */

});