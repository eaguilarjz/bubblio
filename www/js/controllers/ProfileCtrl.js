//ProfileController
angular.module('starter').controller('ProfileCtrl', function($scope, $rootScope, $stateParams, CurrentUser) {
    console.log($rootScope.current_first_name);
    $scope.data = {};

$scope.saveInfo = function() {
        var currentUser = Parse.User.current();
        currentUser.set("firstname", $scope.data.firstname);
		currentUser.set("lastname", $scope.data.lastname);
		return currentUser.save();
}
	
})