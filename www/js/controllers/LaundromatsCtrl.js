angular.module('starter').controller('LaundromatsCtrl', function($scope, $stateParams, Laundromats, Rating, Services) {
    // Get the laundromat list
    Laundromats.get({
        service_id: $stateParams.serviceId,
        latitude: $stateParams.latitude,
        longitude: $stateParams.longitude,
        pickup_date: $stateParams.pickupDate,
        delivery_date: $stateParams.deliveryDate
    }, function(data) {
        $scope.laundromats = data.laundromats;
        // Add ratings
        for (var i=0; i<$scope.laundromats.length; i++) {
            $scope.laundromats[i].stars = Rating.getImages($scope.laundromats[i].avg_score);
        }
    });
    
    Services.get({service_id: $stateParams.serviceId}, function(data){
       $scope.service = data.services[0];
    });

    $scope.serviceId = $stateParams.serviceId;
    $scope.pickupDate = $stateParams.pickupDate;
    $scope.deliveryDate = $stateParams.deliveryDate;
    
   })