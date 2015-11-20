angular.module('starter').controller('AddressCtrl', function($scope, $stateParams, $ionicPopup, $ionicHistory, $state, $filter, Geolocation, Addresses, Countries, States) {    
    $scope.address = {
        addressId: $stateParams.addressId,
        zipCode: '',
        country: 'US',
        state: 'NJ',
        userId: $stateParams.userId
    };
    
    // Function to store an address
    function storeAddress(addrObj) {
        // if this is a new address
        if (addrObj.addressId == 0) {
            Addresses.save({
                user_id: addrObj.userId,
                address_line1: addrObj.addressLine1,
                address_line2: addrObj.addressLine2,
                city: addrObj.city,
                state: addrObj.state,
                zip_code: addrObj.zipCode,
                latitude: addrObj.latitude,
                longitude: addrObj.longitude,
                alias: addrObj.alias
            }, function(data) {
                alert('Address saved!');
                $ionicHistory.nextViewOptions({
                    disableBack: true
                });
                $state.go('app.profile', {latitude: $stateParams.latitude, longitude: $stateParams.longitude});
            });
        // if this is just an update
        } else {
            Addresses.update({
                address_line1: addrObj.addressLine1,
                address_line2: addrObj.addressLine2,
                city: addrObj.city,
                state: addrObj.state,
                zip_code: addrObj.zipCode,
                latitude: addrObj.latitude,
                longitude: addrObj.longitude,
                alias: addrObj.alias,
                address_id: addrObj.addressId,
                user_id: addrObj.userId
            }, function(data) {
                alert('Address updated!');
                $ionicHistory.nextViewOptions({
                    disableBack: true
                });
                $state.go('app.profile', {latitude: $stateParams.latitude, longitude: $stateParams.longitude});
            });
        }
    };
    
    // Function to get the state list
    $scope.getStates = function(country) {
        States.get({country_code: country}, function(data) {
            $scope.states = data.states;
        });
    };
    
    // Get the countries
    Countries.get(function(data) {
        $scope.countries = data.countries;
    });
    

    // Get the states
    $scope.getStates($scope.address.country);
    
    
    // If this is a new address, I complete the filed with the current location
    if ($stateParams.addressId == 0) {
        Geolocation.getAddress($stateParams.latitude,$stateParams.longitude).then(function(data) {
           $scope.address.alias = '';
           $scope.address.addressLine1 = '';
           $scope.address.addressLine2 = '';
           for (var i=0; i < data.address.address_components.length; i++) {
                for (var j=0; j < data.address.address_components[i].types.length; j++) {
                    switch (data.address.address_components[i].types[j]) {
                        case 'premise':
                        case 'street_number':
                        case 'route':
                            $scope.address.addressLine1 += ' ' + data.address.address_components[i].long_name;
                            break;
                        case 'locality':
                            $scope.address.addressLine2 += ' ' + data.address.address_components[i].long_name;
                            break;
                        case 'postal_code':
                            $scope.address.zipCode = data.address.address_components[i].long_name;                
                    }
                }
           }
           $scope.address.addressLine1 = $scope.address.addressLine1.trim();
           $scope.address.addressLine2 = $scope.address.addressLine2.trim();         
        });
    // Otherwise, I need to retrieve the details of an existing address from the database
    } else {
        Addresses.get({user_id: $stateParams.userId, address_id: $stateParams.addressId}, function(data) {
           $scope.address.alias = data.addresses[0].alias;            
           $scope.address.addressLine1 = data.addresses[0].address_line1;
           $scope.address.addressLine2 = data.addresses[0].address_line2;
           $scope.address.city = data.addresses[0].city;
           $scope.address.zipCode = data.addresses[0].zip_code;
           $scope.address.state = data.addresses[0].state_code;
           $scope.address.country = data.addresses[0].country_code;  
           $scope.address.latitude = data.addresses[0].latitude;
           $scope.address.longitude = data.addresses[0].longitude;            
        });
    }
    
    $scope.saveAddress = function() {
        // Confirm if it is needed to call the Google API
        var confirmPopup = $ionicPopup.confirm({
         title: 'Confirm location',
         template: 'Is this address your current location?'
        });
        confirmPopup.then(function(res) {
         if(res) {
            $scope.address.latitude = $stateParams.latitude;
            $scope.address.longitude = $stateParams.longitude;
            storeAddress($scope.address);
         } else {
            // Validate the address
            Geolocation.codeAddress($scope.address.addressLine1 + ', ' + $scope.address.addressLine2 + ', ' + $scope.address.city + ' ' 
                                    + $scope.address.state.substring(3) + ', ' + $scope.address.country + ' ' + $scope.address.zipCode).then(function(data) {
                if (!data.error) {
                    storeAddress($scope.address);
                }
            }); 
         }
        });
    };
    
    $scope.cancel = function() {
        $ionicHistory.nextViewOptions({
            disableBack: true
        });
        $state.go('app.profile', {latitude: $stateParams.latitude, longitude: $stateParams.longitude});
    }
    
    $scope.$watch(function(scope) {return scope.address.zipCode}, function() {
        if ($scope.address.zipCode.length == 5) {
            Geolocation.getInfoFromZip().get({zipcode: $scope.address.zipCode}, function(data) {
                if (typeof data.error == 'undefined') {
                    $scope.address.city = data.city;
                    $scope.address.state = data.country + '-' + data.state;
                    $scope.address.country = data.country;
                }
            });
        }
    });
});