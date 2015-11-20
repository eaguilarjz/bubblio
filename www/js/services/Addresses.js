angular.module('starter').factory('Addresses', function($resource, RESTFUL_URL) {
    return $resource(RESTFUL_URL + '/addresses/:user_id/:address_id', null, {
        update: {method: 'PUT'}
    });
});