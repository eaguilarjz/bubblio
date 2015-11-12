angular.module('starter').controller('SearchCtrl', function($scope, $stateParams, Geolocation, Services) {
   
    // Get the current location
    $scope.currentLocation = Geolocation.get();
    
    // Get the service list
    Services.get({}, function(res) {
        $scope.services = res.services;
    });
    
    $scope.searchParams = {
        service: $stateParams.serviceId,
        pickupDate: new Date(2015, 9, 26, 8, 0, 0, 0),
        deliveryDate: new Date(2015, 9, 29, 20, 0, 0, 0)
    };
    
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

});