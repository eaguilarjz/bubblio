angular.module('starter').factory('Datetime', function() {
    return {
        toDate: function(dateString) {
            var year = dateString.substring(0,4);
            var month = dateString.substring(4,6) - 1;
            var day = dateString.substring(6,8);
            var hours = dateString.substring(8,10);
            var minutes = dateString.substring(10,12);
            var seconds = dateString.substring(12,14);
            var date = new Date(year, month, day, hours, minutes, seconds, 0);
            return date;
        }
    };
})