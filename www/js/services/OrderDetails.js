angular.module('starter').factory('OrderDetails', function($resource, RESTFUL_URL) {
   return $resource(RESTFUL_URL + '/order_details/:order_id');
});