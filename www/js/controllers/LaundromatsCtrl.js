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
    $scope.currentLatitude = $stateParams.latitude;
    $scope.currentLongitude = $stateParams.longitude;
    

})
    .directive('map', function($stateParams, $ionicLoading, $compile, Laundromats, Rating, Services) {
    return {
       scope: true,
        link:function(scope, element, attrs){

            var zValue = 13;

            var myLatlng = new google.maps.LatLng($stateParams.latitude,$stateParams.longitude),
            mapOptions = {
                zoom: zValue,
                center: myLatlng
            },
            contentString = "<div><a ng-click='clickTest()'>My Location!</a></div>";
            infowindow = new google.maps.InfoWindow({
                content: contentString
            });
            map = new google.maps.Map(element[0],mapOptions),
            marker = new google.maps.Marker({
                position: myLatlng,
                map: map,
            });
            marker.addListener('click', function() {
                infowindow.open(map, marker);
            });

            var info = new google.maps.InfoWindow;

            for(var i = 0; i <scope.laundromats.length;  i++){
                var address = {lat: scope.laundromats[i].latitude, lng: scope.laundromats[i].longitude};

                var markers = new google.maps.Marker({
                    position: address,
                    map: map,
                    title: scope.laundromats[i].name
                });

                google.maps.event.addListener(markers, 'click', (function(markers, i) {
                    return function() {
                    info.setContent(scope.laundromats[i].name+ "\n price: " + scope.laundromats[i].quotation_price+"\t score:"+scope.laundromats[i].avg_score);
                    info.open(map, markers);
                    }
                })(markers, i));
            }
        }
    };

});