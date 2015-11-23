<<<<<<< Updated upstream
=======
<<<<<<< HEAD
angular.module('starter').controller('OrdersCtrl', function($scope, $stateParams, CurrentUser, Orders) {
	Orders.get({user_id: CurrentUser.getUserId()
	}, function(data){
		$scope.orders = data.orders;
	})
=======
>>>>>>> Stashed changes
angular.module('starter').controller('OrdersCtrl', function($scope, $stateParams, Orders, CurrentUser) {
    $scope.userId = CurrentUser.getUserId();
    
    Orders.get({user_id: $scope.userId}, function(data) {
        $scope.orders = data.orders;
    });
<<<<<<< Updated upstream
=======
>>>>>>> origin/master
>>>>>>> Stashed changes
});