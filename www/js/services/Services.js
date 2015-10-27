angular.module('starter').factory('Services', function($resource, RESTFUL_URL) {
   return $resource(
       RESTFUL_URL + '/services/:service_id'
   );
});