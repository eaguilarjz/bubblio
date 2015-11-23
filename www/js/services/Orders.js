angular.module('starter').factory('Orders', function($resource, RESTFUL_URL) {

   return $resource(RESTFUL_URL + '/orders/:user_id');

});