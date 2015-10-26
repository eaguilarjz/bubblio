angular.module('starter').factory('Laundromats', function($resource, RESTFUL_URL) {
   return $resource(
        RESTFUL_URL + '/laundromats/:site_id/:service_id/:latitude/:longitude/:pickup_date/:delivery_date'
   ); 
});