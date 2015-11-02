//ProfileController
angular.module('starter').controller('ProfileCtrl', function($scope, $rootScope, $stateParams, CurrentUser) {
    $scope.data = {};

    $scope.saveInfo = function() {
            var currentUser = Parse.User.current();
            currentUser.set("firstname", $scope.data.firstname);
            currentUser.set("lastname", $scope.data.lastname);
            return currentUser.save();
    }
	
});