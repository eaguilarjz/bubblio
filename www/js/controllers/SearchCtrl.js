angular.module('starter').controller('SearchCtrl', function($scope, $stateParams, Geolocation, Services, CurrentUser, Addresses) {
   
    // Get the current location
    $scope.currentLocation = Geolocation.get();
    $scope.user_id = CurrentUser.getUserId();
    
    // Get the service list
    Services.get({}, function(res) {
        $scope.services = res.services;
    });
    
    // Retrieve the address
    Addresses.get({user_id: $scope.user_id}, function(data) {
        $scope.addresses = data.addresses;
        $scope.address_id = data.addresses[0].address_id;
    });
    
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