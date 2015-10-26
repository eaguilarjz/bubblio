angular.module('starter').factory('Customers', function($resource, RESTFUL_URL) {
    return $resource(RESTFUL_URL + '/customers/:user_id');
});