angular.module('starter').controller('SearchCtrl', function($scope, $stateParams, $ionicPopup, $state, $filter, Geolocation, Services, CurrentUser, Addresses) {
   
    // Get the current location
    $scope.currentLocation = Geolocation.get();
    $scope.user_id = CurrentUser.getUserId();
    
    // Get the service list
    Services.get({}, function(res) {
        for (var i=0; i< res.services.length; i++) {
            if (res.services[i].service_id == $stateParams.serviceId) {
                $scope.services = [res.services[i]];
            }
        }
    });
    
    // Retrieve the address
    Addresses.get({user_id: $scope.user_id}, function(data) {
        $scope.addresses = data.addresses;
        if (data.addresses.length == 0) {
            alert(data.addresses.length);
            var alertPopup = $ionicPopup.alert({
                title: 'No addresses found',
                template: 'You will be redirected to your profile page to allow you to add an address!'
            });
            alertPopup.then(function(res) {
                $state.go('app.profile', {latitude: $scope.currentLocation.latitude, longitude: $scope.currentLocation.longitude})
            });         
            return;
        }
        $scope.addressId = data.addresses[0].address_id;
        $scope.currentLocation.latitude = data.addresses[0].latitude;
        $scope.currentLocation.longitude = data.addresses[0].longitude;
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
    
    $scope.searchParams = {
        service: $stateParams.serviceId,
        pickupDate: new Date(),
        deliveryDate: new Date()
    };
    
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