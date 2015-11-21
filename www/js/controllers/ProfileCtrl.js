//ProfileController
angular.module('starter.controllers')

.controller('ProfileCtrl', function($scope, $state, $rootScope, $stateParams, $ionicPopup, CurrentUser, Addresses, Geolocation) {
    $scope.data = {};
	
	$scope.data.firstname = CurrentUser.getCurrentFirstName();
	$scope.data.lastname = CurrentUser.getCurrentLastName();
    $scope.latitude = $stateParams.latitude;
    $scope.longitude = $stateParams.longitude;
    
    // Retrieve the address
    $scope.user_id = CurrentUser.getUserId();
    Addresses.get({user_id: $scope.user_id}, function(data) {
        $scope.addresses = data.addresses;
    });

    $scope.saveInfo = function() {
    	var currentUser = Parse.User.current();
        currentUser.set("firstname", $scope.data.firstname);
        currentUser.set("lastname", $scope.data.lastname);
        currentUser.save();
        alert("Profile saved.");
    };
    
    $scope.deleteAddress = function(addrId) {
        var confirmPopup = $ionicPopup.confirm({
         title: 'Confirmation required',
         template: 'Are you sure you want to delete this address?'
        });
        confirmPopup.then(function(res) {
         if(res) {
           Addresses.delete({address_id: addrId}, function(data) {
              if (!data.Error) {
                var alertPopup = $ionicPopup.alert({
                 title: 'Confirmation',
                 template: 'Address deleted!'
                });
                alertPopup.then(function(res) {
                    for (var i=0; i < $scope.addresses.length; i++) {
                        if ($scope.addresses[i].address_id == addrId) {
                            $scope.addresses.splice(i,1);
                            break;
                        }
                    }
                });
              } 
           });
         }
        });
    };
    
    $scope.newAddress = function() {
        // TODO: Add code to redirect to new address pages and load the data
        $state.go('app.address', {userId: $scope.user_id, addressId: 0, latitude: $scope.latitude, longitude: $scope.longitude});
    }	
});