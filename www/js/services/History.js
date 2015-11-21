angular.module('starter').factory('History', function($resource, RESTFUL_URL) {
   return $resource(RESTFUL_URL + '/history/:order_id');
});