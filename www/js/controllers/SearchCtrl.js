angular.module('starter').controller('SearchCtrl', function($scope, Geolocation, Services) {
   
    // Get the current location
    $scope.currentLocation = Geolocation.get();
    
    // Get the service list
    Services.get({}, function(res) {
        $scope.services = res.services;
    });
    
    $scope.searchParams = {
        service: 1,
        pickupDate: new Date(2015, 9, 26, 8, 0, 0, 0),
        deliveryDate: new Date(2015, 9, 29, 20, 0, 0, 0)
    };
});