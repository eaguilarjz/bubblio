angular.module('starter').factory('States', function($resource, RESTFUL_URL) {
   return $resource(
       RESTFUL_URL + '/states/:country_code'
   );
});