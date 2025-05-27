// Admin2 manage members endpoint
router.post('/group/:conversationId/admin2/remove/:memberId', userAuth, chatController.removeMemberByAdmin2); 