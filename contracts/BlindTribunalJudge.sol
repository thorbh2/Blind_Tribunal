// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BlindTribunalJudge
/// @notice Fair bounty submissions: commit hidden answers first, reveal after the deadline, then batch judge once.
/// @dev Standalone Solidity contract with no imports, deployable on any EVM chain.
contract BlindTribunalJudge {
    struct Bounty {
        address creator;
        string promptCid;
        bytes32 promptHash;
        uint64 commitDeadline;
        uint64 revealDeadline;
        bool judged;
        bool finalized;
        bytes32 llmInputHash;
        uint256 winnerIndex;
        uint256 winnerSubmissionId;
        address winner;
        uint256 commitmentCount;
        uint256 revealCount;
    }

    struct Submission {
        address participant;
        bytes32 commitment;
        uint64 committedAt;
        uint64 revealedAt;
        bool revealed;
        bytes32 salt;
        bytes32 answerHash;
        string answer;
    }

    address public owner;
    uint256 public nextBountyId = 1;

    mapping(address => bool) public judges;
    mapping(uint256 => Bounty) public bounties;
    mapping(uint256 => uint256[]) private revealedSubmissionIds;
    mapping(uint256 => mapping(uint256 => Submission)) public submissions;
    mapping(uint256 => mapping(address => uint256)) public submissionIdOf;

    event OwnerTransferred(address indexed previousOwner, address indexed nextOwner);
    event JudgeSet(address indexed judge, bool trusted);
    event BountyCreated(
        uint256 indexed bountyId,
        address indexed creator,
        bytes32 promptHash,
        string promptCid,
        uint64 commitDeadline,
        uint64 revealDeadline
    );
    event CommitmentSubmitted(uint256 indexed bountyId, uint256 indexed submissionId, address indexed participant, bytes32 commitment);
    event AnswerRevealed(uint256 indexed bountyId, uint256 indexed submissionId, address indexed participant, bytes32 answerHash);
    event BatchJudged(uint256 indexed bountyId, bytes32 llmInputHash, uint256 eligibleCount, address indexed judge);
    event WinnerFinalized(uint256 indexed bountyId, uint256 indexed winnerIndex, uint256 indexed submissionId, address winner);

    error NotOwner();
    error NotJudgeOrCreator();
    error BadBounty();
    error BadDeadline();
    error CommitPhaseClosed();
    error RevealPhaseClosed();
    error RevealPhaseNotOpen();
    error EmptyCommitment();
    error EmptyAnswer();
    error AlreadyCommitted();
    error CommitmentMissing();
    error AlreadyRevealed();
    error InvalidReveal();
    error NoEligibleAnswers();
    error AlreadyJudged();
    error JudgingNotOpen();
    error NotJudged();
    error AlreadyFinalized();
    error BadWinnerIndex();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyJudgeOrCreator(uint256 bountyId) {
        Bounty storage bounty = bounties[bountyId];
        if (bounty.creator == address(0)) revert BadBounty();
        if (msg.sender != bounty.creator && !judges[msg.sender]) revert NotJudgeOrCreator();
        _;
    }

    constructor() {
        owner = msg.sender;
        judges[msg.sender] = true;
        emit OwnerTransferred(address(0), msg.sender);
        emit JudgeSet(msg.sender, true);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert BadBounty();
        address previousOwner = owner;
        owner = nextOwner;
        emit OwnerTransferred(previousOwner, nextOwner);
    }

    function setJudge(address judge, bool trusted) external onlyOwner {
        if (judge == address(0)) revert BadBounty();
        judges[judge] = trusted;
        emit JudgeSet(judge, trusted);
    }

    function createBounty(
        string calldata promptCid,
        bytes32 promptHash,
        uint64 commitDeadline,
        uint64 revealDeadline
    ) external returns (uint256 bountyId) {
        uint64 nowTime = _now64();
        if (bytes(promptCid).length == 0 || promptHash == bytes32(0)) revert BadBounty();
        if (commitDeadline <= nowTime || revealDeadline <= commitDeadline) revert BadDeadline();

        bountyId = nextBountyId++;
        Bounty storage bounty = bounties[bountyId];
        bounty.creator = msg.sender;
        bounty.promptCid = promptCid;
        bounty.promptHash = promptHash;
        bounty.commitDeadline = commitDeadline;
        bounty.revealDeadline = revealDeadline;
        bounty.winnerIndex = type(uint256).max;

        emit BountyCreated(bountyId, msg.sender, promptHash, promptCid, commitDeadline, revealDeadline);
    }

    function submitCommitment(uint256 bountyId, bytes32 commitment) external {
        Bounty storage bounty = bounties[bountyId];
        if (bounty.creator == address(0)) revert BadBounty();
        if (_now64() > bounty.commitDeadline) revert CommitPhaseClosed();
        if (commitment == bytes32(0)) revert EmptyCommitment();
        if (submissionIdOf[bountyId][msg.sender] != 0) revert AlreadyCommitted();

        uint256 submissionId = ++bounty.commitmentCount;
        submissionIdOf[bountyId][msg.sender] = submissionId;
        submissions[bountyId][submissionId] = Submission({
            participant: msg.sender,
            commitment: commitment,
            committedAt: _now64(),
            revealedAt: 0,
            revealed: false,
            salt: bytes32(0),
            answerHash: bytes32(0),
            answer: ""
        });

        emit CommitmentSubmitted(bountyId, submissionId, msg.sender, commitment);
    }

    function revealAnswer(uint256 bountyId, string calldata answer, bytes32 salt) external {
        Bounty storage bounty = bounties[bountyId];
        if (bounty.creator == address(0)) revert BadBounty();

        uint64 nowTime = _now64();
        if (nowTime <= bounty.commitDeadline) revert RevealPhaseNotOpen();
        if (nowTime > bounty.revealDeadline) revert RevealPhaseClosed();
        if (bytes(answer).length == 0) revert EmptyAnswer();

        uint256 submissionId = submissionIdOf[bountyId][msg.sender];
        if (submissionId == 0) revert CommitmentMissing();

        Submission storage submission = submissions[bountyId][submissionId];
        if (submission.revealed) revert AlreadyRevealed();
        if (computeCommitment(answer, salt, msg.sender, bountyId) != submission.commitment) revert InvalidReveal();

        submission.revealed = true;
        submission.revealedAt = nowTime;
        submission.salt = salt;
        submission.answerHash = keccak256(bytes(answer));
        submission.answer = answer;
        bounty.revealCount += 1;
        revealedSubmissionIds[bountyId].push(submissionId);

        emit AnswerRevealed(bountyId, submissionId, msg.sender, submission.answerHash);
    }

    function judgeAll(uint256 bountyId, bytes calldata llmInput) external onlyJudgeOrCreator(bountyId) {
        Bounty storage bounty = bounties[bountyId];
        if (_now64() <= bounty.revealDeadline) revert JudgingNotOpen();
        if (bounty.revealCount == 0) revert NoEligibleAnswers();
        if (bounty.judged) revert AlreadyJudged();
        if (llmInput.length == 0) revert EmptyAnswer();

        bounty.judged = true;
        bounty.llmInputHash = keccak256(llmInput);

        emit BatchJudged(bountyId, bounty.llmInputHash, bounty.revealCount, msg.sender);
    }

    function finalizeWinner(uint256 bountyId, uint256 winnerIndex) external onlyJudgeOrCreator(bountyId) {
        Bounty storage bounty = bounties[bountyId];
        if (!bounty.judged) revert NotJudged();
        if (bounty.finalized) revert AlreadyFinalized();

        uint256[] storage revealedIds = revealedSubmissionIds[bountyId];
        if (winnerIndex >= revealedIds.length) revert BadWinnerIndex();

        uint256 submissionId = revealedIds[winnerIndex];
        Submission storage winningSubmission = submissions[bountyId][submissionId];
        if (!winningSubmission.revealed) revert BadWinnerIndex();

        bounty.finalized = true;
        bounty.winnerIndex = winnerIndex;
        bounty.winnerSubmissionId = submissionId;
        bounty.winner = winningSubmission.participant;

        emit WinnerFinalized(bountyId, winnerIndex, submissionId, winningSubmission.participant);
    }

    function computeCommitment(
        string memory answer,
        bytes32 salt,
        address participant,
        uint256 bountyId
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(answer, salt, participant, bountyId));
    }

    function getRevealedSubmissionIds(uint256 bountyId) external view returns (uint256[] memory) {
        return revealedSubmissionIds[bountyId];
    }

    function getRevealedSubmissionCount(uint256 bountyId) external view returns (uint256) {
        return revealedSubmissionIds[bountyId].length;
    }

    function _now64() internal view returns (uint64) {
        uint256 timestamp = block.timestamp;
        if (timestamp > 10_000_000_000) timestamp = timestamp / 1_000;
        return uint64(timestamp);
    }
}
