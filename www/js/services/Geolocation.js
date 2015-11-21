angular.module('starter').factory('Geolocation', function($q, $resource) {
    return {
        get: function() {
            var currentPosition = {
                error: false,
                errorMessage: "",
                latitude: 0,
                longitude: 0
            };

            // onSuccess Callback
            // This method accepts a Position object, which contains the
            // current GPS coordinates
            //
            var onSuccess = function(position) {
                currentPosition.error = false;
                currentPosition.latitude = position.coords.latitude;
                currentPosition.longitude = position.coords.longitude;
            };  

            // onError Callback receives a PositionError object
            //
            var onError = function (error) {
                currentPosition.error = true;
                currentPosition.errorMessage = error.message;
            }

            // Get the location
            navigator.geolocation.getCurrentPosition(onSuccess, onError);
            return currentPosition;
        },
        
        getAddress: function(lat, lng) {
            var geocoder = new google.maps.Geocoder();
            var latlng = new google.maps.LatLng(parseFloat(lat), parseFloat(lng));
            return $q(function(resolve,reject) {
                var responseObject = {error: false, message:null};
                geocoder.geocode({ 'location': latlng }, function (results, status) {
                    if (status == google.maps.GeocoderStatus.OK) {
                        if (results[0]) {
                            responseObject.address = results[0];
                            resolve(responseObject);
                        } else {
                            responseObject.error = true;
                            responseObject.address = null;
                            responseObject.message = 'Location not found';
                            reject(responseObject);
                        }
                    } else {
                        responseObject.error = true;
                        responseObject.address = null;
                        responseObject.message = 'Geocoder failed due to: ' + status;
                        reject(responseObject);
                    }
                });
            });
        },
        
        codeAddress: function(addr) {
            return $q(function(resolve, reject) {
                var responseObject = {error: false, message:null};
                var geocoder = new google.maps.Geocoder();
                geocoder.geocode( { 'address': addr}, function(results, status) {
                    if (status == google.maps.GeocoderStatus.OK) {
                        if (results[0]) {
                            responseObject.address = results[0];
                            resolve(responseObject);
                        } else {
                            responseObject.error = true;
                            responseObject.address = null;
                            responseObject.message = 'Location not found';
                            reject(responseObject);
                        }
                    } else {
                        responseObject.error = true;
                        responseObject.address = null;
                        responseObject.message = 'Geocode failed due to: ' + status;
                        reject(responseObject);
                    }
                }); 
            });   
        },
        
        getInfoFromZip: function() {
            return $resource('http://ziptasticapi.com/:zipcode');
        }
    };
});