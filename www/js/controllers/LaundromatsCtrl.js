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
    $scope.addressId = $stateParams.addressId;

    $scope.serviceId = $stateParams.serviceId;
    $scope.pickupDate = $stateParams.pickupDate;
    $scope.deliveryDate = $stateParams.deliveryDate;
    $scope.currentLatitude = $stateParams.latitude;
    $scope.currentLongitude = $stateParams.longitude;

    //add filter
    
    $scope.boxs=[{id:1,name:"distance"},{id:2,name:"rank"},{id:3,name:"price"}];
    $scope.changedValue=function(item){
        var selectedValue  = item.id;
        if(selectedValue == 1){
            $scope.laundromats.sort(function(a,b){
                if(((a.latitude-$stateParams.latitude)*(a.latitude-$stateParams.latitude))+((a.longitude-$stateParams.longitude)*(a.longitude-$stateParams.longitude))
                    > ((b.latitude-$stateParams.latitude)*(b.latitude-$stateParams.latitude))+((b.longitude-$stateParams.longitude)*(b.longitude-$stateParams.longitude))){
                    return 1;
                }
                if(((a.latitude-$stateParams.latitude)*(a.latitude-$stateParams.latitude))+((a.longitude-$stateParams.longitude)*(a.longitude-$stateParams.longitude))
                    < ((b.latitude-$stateParams.latitude)*(b.latitude-$stateParams.latitude))+((b.longitude-$stateParams.longitude)*(b.longitude-$stateParams.longitude))){
                    return -1;
                }
                if(((a.latitude-$stateParams.latitude)*(a.latitude-$stateParams.latitude))+((a.longitude-$stateParams.longitude)*(a.longitude-$stateParams.longitude))
                    == ((b.latitude-$stateParams.latitude)*(b.latitude-$stateParams.latitude))+((b.longitude-$stateParams.longitude)*(b.longitude-$stateParams.longitude))){
                    return 0;
                }
            })
        }
        if(selectedValue == 2){
            $scope.laundromats.sort(function(a,b){
                if(a.avg_score > b.avg_score){
                    return -1;
                }
                if(a.avg_score < b.avg_score){
                    return 1;
                }
                if(a.avg_score == b.avg_score){
                    return 0;
                }
            })
        }
        if(selectedValue == 3){
             $scope.laundromats.sort(function(a,b){
                if(a.quotation_price > b.quotation_price){
                    return 1;
                }
                if(a.quotation_price < b.quotation_price){
                    return -1;
                }
                if(a.quotation_price == b.quotation_price){
                    return 0;
                }
            })
        }
    }


})
    .directive('map', function($stateParams, $ionicLoading, $compile, Laundromats, Rating, Services) {
    return {
       scope: true,
        link:function(scope, element, attrs){

        var zValue = 15;
    
        var pinColor = "3ddb3f";
        var pinImage = new google.maps.MarkerImage("http://chart.apis.google.com/chart?chst=d_map_xpin_letter&chld=pin_star|A|" + pinColor,
        new google.maps.Size(21, 34),
        new google.maps.Point(0,0),
        new google.maps.Point(10, 34));

        map = new google.maps.Map(element[0],
            mapOptions);

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
                icon: pinImage
            });
                infowindow.open(map, marker);
             

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
                    info.setContent("<a href='#/app/laundromats/"+ scope.laundromats[i].site_id +"/"+ $stateParams.serviceId +"/"+ $stateParams.pickupDate +"/"+ $stateParams.deliveryDate+"/"+ scope.addressId+ "'>"+
                        scope.laundromats[i].name+"</a><br/>" +"Price: " + scope.laundromats[i].quotation_price +"/lb" + " Score: "+scope.laundromats[i].avg_score);
                    info.open(map, markers);
                    }
                })(markers, i));
            }
        }
    };

});