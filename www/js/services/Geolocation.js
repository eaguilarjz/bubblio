angular.module('starter').factory('Geolocation', function() {
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
    
    return {
        get: function() {
            return currentPosition;
        }
    }
});