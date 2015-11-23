angular.module('starter').factory('Orders', function($resource, RESTFUL_URL) {
<<<<<<< Updated upstream
   return $resource(RESTFUL_URL + '/orders/:user_id/:order_id');
=======
<<<<<<< HEAD
   return $resource(RESTFUL_URL + '/orders/:user_id');
=======
   return $resource(RESTFUL_URL + '/orders/:user_id/:order_id');
>>>>>>> origin/master
>>>>>>> Stashed changes
});